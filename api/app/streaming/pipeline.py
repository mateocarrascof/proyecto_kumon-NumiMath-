"""Respuesta por streaming con re-chequeo de acceso (ADR 0001, decisión 2.4).

Garantías:
- Nada llega al niño sin pasar por el filtro de salida (por oraciones).
- Cada `recheck_seconds` (o menos) se vuelve a comprobar que el perfil sigue autorizado
  (perfil del tutor, no bloqueado, consentimiento vigente). Si ya no, el stream se CORTA, aunque
  el proveedor esté en silencio: una revocación corta la respuesta en pocos segundos.
- Duración máxima acotada (`max_seconds`).
- Ante un error de la base al re-chequear, se corta (falla cerrado).
- Si el cliente se desconecta, se cierra al proveedor y se libera todo.

El generador devuelve eventos SSE ya formateados. Nunca registra texto del niño ni de la IA.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any, Final

from app.access.authorize import AuthorizedStudent
from app.ai.provider import AIProvider, MathPrompt
from app.db.gateway import Gateway, GatewayError
from app.logging import get_logger, log_event
from app.safety.output_filter import NEUTRAL_MESSAGE, OutputGuard

logger = get_logger("mathtutor.stream")

_END: Final = object()

# Mensajes neutros para el niño (no explican el motivo interno).
STREAM_MESSAGES: Final[dict[str, str]] = {
    "output_blocked": NEUTRAL_MESSAGE,
    "access_revoked": "La sesión ya no está disponible. Pide ayuda a un adulto.",
    "service_unavailable": "No pude verificar el acceso. Intenta de nuevo en un momento.",
    "stream_timeout": "La respuesta tardó demasiado. ¡Intenta otra vez!",
    "provider_error": "Ups, hubo un problema. Intenta de nuevo en un momento.",
}


@dataclass(frozen=True)
class StreamConfig:
    max_seconds: float
    recheck_seconds: float


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Un evento SSE. `data` va en JSON: los saltos de línea quedan escapados."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _error_event(code: str) -> str:
    return sse_event("error", {"code": code, "message": STREAM_MESSAGES[code]})


async def _next_chunk(iterator: AsyncIterator[str]) -> object:
    try:
        return await iterator.__anext__()
    except StopAsyncIteration:
        return _END


async def _still_authorized(gateway: Gateway, student: AuthorizedStudent) -> str | None:
    """`None` si sigue autorizado; si no, el código de corte."""
    try:
        code = await gateway.authorize_student_use(student.tutor_id, student.student_id)
    except GatewayError:
        return "service_unavailable"
    return None if code == "ok" else "access_revoked"


async def stream_explanation(
    *,
    provider: AIProvider,
    prompt: MathPrompt,
    gateway: Gateway,
    student: AuthorizedStudent,
    config: StreamConfig,
    clock: Callable[[], float] = time.monotonic,
) -> AsyncIterator[str]:
    guard = OutputGuard()
    started = clock()
    last_check = started
    iterator = provider.stream(prompt).__aiter__()
    pending: asyncio.Future[object] | None = None
    outcome = "ok"
    code = ""

    log_event(logger, "stream.started", stage="stream")
    try:
        while True:
            now = clock()
            if now - started >= config.max_seconds:
                outcome, code = "cut", "stream_timeout"
                yield _error_event(code)
                return

            if now - last_check >= config.recheck_seconds:
                problem = await _still_authorized(gateway, student)
                last_check = clock()
                if problem is not None:
                    outcome, code = "cut", problem
                    yield _error_event(problem)
                    return

            if pending is None:
                pending = asyncio.ensure_future(_next_chunk(iterator))

            # Se espera el siguiente fragmento, pero sin pasar del próximo re-chequeo ni del
            # límite de duración. `asyncio.wait` NO cancela el futuro al vencer el plazo.
            until_check = config.recheck_seconds - (clock() - last_check)
            until_end = config.max_seconds - (clock() - started)
            timeout = max(0.001, min(until_check, until_end))  # 1 ms: evita un bucle caliente
            done, _ = await asyncio.wait({pending}, timeout=timeout)
            if not done:
                continue

            try:
                result = pending.result()
            except Exception as exc:
                outcome, code = "cut", "provider_error"
                log_event(logger, "stream.provider_error", code=type(exc).__name__)
                yield _error_event("provider_error")
                return
            finally:
                pending = None

            if result is _END:
                break

            sentences, violation = guard.feed(str(result))
            for sentence in sentences:
                yield sse_event("chunk", {"text": sentence})
            if violation is not None:
                outcome, code = "cut", "output_blocked"
                log_event(logger, "stream.blocked", code=violation.reason)
                yield _error_event("output_blocked")
                return

        sentences, violation = guard.flush()
        for sentence in sentences:
            yield sse_event("chunk", {"text": sentence})
        if violation is not None:
            outcome, code = "cut", "output_blocked"
            log_event(logger, "stream.blocked", code=violation.reason)
            yield _error_event("output_blocked")
            return
        yield sse_event("done", {})
    finally:
        # También se ejecuta si el cliente se desconecta (el generador se cancela o se cierra).
        if pending is not None:
            if not pending.done():
                pending.cancel()
            # Hay que esperar a que la tarea termine: mientras el generador del proveedor siga
            # "corriendo" dentro de ella, no se puede cerrar y su limpieza no se ejecutaría.
            try:
                await pending
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                log_event(logger, "stream.close_error", code=type(exc).__name__)
        aclose = getattr(iterator, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception as exc:
                log_event(logger, "stream.close_error", code=type(exc).__name__)
        log_event(logger, "stream.finished", stage="stream", outcome=outcome, code=code)
