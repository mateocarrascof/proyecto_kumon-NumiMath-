"""Sincronizar los intentos hechos sin conexión (CU-A13, ADR 0002).

Orden: JWT → perfil del tutor, no bloqueado y con consentimiento (AuthorizedStudentDep, ADR 0001)
→ por cada intento: token del lote verificado (dominio propio, ligado a ESTE perfil, con el
margen de 14 días) y respuesta vuelta a corregir → todos los válidos en UNA llamada a la base,
en orden cronológico.

Un endpoint por perfil (no se mezclan perfiles): si uno está bloqueado o se borró, su petición
responde 403 y los demás perfiles se sincronizan igual.

Lo que manda el cliente y NO se usa: `correct`, `level` y `topic` (se ignoran: el tema y el nivel
salen del token y la corrección se rehace aquí). La hora y la fecha local se acotan a la vida del
token. Reenviar el mismo lote no cambia nada: el `jti` del token es único por perfil en la base.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.db.gateway import Gateway, GatewayError, OfflineAttempt
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.tokens import InvalidExercise, verify
from app.logging import get_logger, log_event
from app.routes.common import signing_key

router = APIRouter(prefix="/v1/students", tags=["offline"])
logger = get_logger("mathtutor.offline")

# Tope de intentos por petición: la app envía en lotes de este tamaño. 15 porque el cuerpo de
# toda petición tiene un tope de 8 KB (`max_body_bytes`) y un intento pesa hasta ~410 bytes; así no
# se toca ese límite de seguridad. La base tiene además un tope de defensa de 100.
SYNC_BATCH_LIMIT = 15
# Tiempo por ejercicio: más que esto se guarda sin tiempo (decisión 7 del ADR 0002).
MAX_DURATION_S = 600


class SyncAttemptIn(BaseModel):
    # `extra="ignore"`: si el cliente manda `correct`, `level` o `topic`, se descartan aquí.
    model_config = ConfigDict(extra="ignore")

    # Id generado en el dispositivo: solo para decirle a la app qué pasó con cada intento.
    id: uuid.UUID
    token: Annotated[str, Field(min_length=10, max_length=600)]
    # Mismos topes que el teclado de la app (7 dígitos; denominador de 4): un intento fuera de los
    # topes del servidor en línea NO debe hacer fallar el lote entero (422) y atascar la cola. Lo
    # raro se decide por intento en `_prepare` (un denominador 0 se rechaza solo ese intento).
    answer: Annotated[int, Field(ge=0, le=9_999_999)]
    answer_den: Annotated[int, Field(ge=0, le=9999)] | None = None
    answered_at: datetime
    local_date: date | None = None
    duration_s: Annotated[int, Field(ge=0)] | None = None


class SyncRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    attempts: Annotated[list[SyncAttemptIn], Field(min_length=1, max_length=SYNC_BATCH_LIMIT)]


class SyncResultOut(BaseModel):
    id: uuid.UUID
    # accepted: registrado ahora. duplicate: ya estaba (reenvío o token ya respondido).
    # rejected: no se registrará nunca (token inválido, vencido tras el margen o de otro perfil).
    # Los tres son definitivos: la app los quita de la cola.
    status: Literal["accepted", "duplicate", "rejected"]


class SyncOut(BaseModel):
    results: list[SyncResultOut]


def _clamp_time(value: datetime, low: int, high: int) -> datetime:
    """Hora del intento dentro de [emisión, min(caducidad, ahora)]: el reloj del dispositivo puede
    estar mal o manipulado, y fuera de la vida del token el intento no pudo ocurrir."""
    ts = value.timestamp() if value.tzinfo else value.replace(tzinfo=UTC).timestamp()
    return datetime.fromtimestamp(min(max(ts, low), high), tz=UTC)


def _local_day(value: date | None, low: int, high: int) -> date | None:
    """Fecha local creíble: dentro de la vida del token, con ±1 día por la zona horaria."""
    if value is None:
        return None
    first = datetime.fromtimestamp(low, tz=UTC).date() - timedelta(days=1)
    last = datetime.fromtimestamp(high, tz=UTC).date() + timedelta(days=1)
    return value if first <= value <= last else None


def _prepare(
    key: bytes, student_id: uuid.UUID, attempts: list[SyncAttemptIn], grace_s: int, now: float
) -> tuple[list[tuple[uuid.UUID, OfflineAttempt]], list[tuple[uuid.UUID, str]]]:
    """Verifica los tokens y vuelve a corregir. CPU pura (HMAC y generador por intento): se corre
    fuera del event loop. Devuelve (válidos con su id del dispositivo, rechazados con su motivo)."""
    valid: list[tuple[uuid.UUID, OfflineAttempt]] = []
    rejected: list[tuple[uuid.UUID, str]] = []
    for item in attempts:
        try:
            verified = verify(key, item.token, student_id, now=now, offline=True, grace_s=grace_s)
        except InvalidExercise:
            rejected.append((item.id, "token_invalid"))
            continue
        exercise = verified.exercise
        if exercise.is_fraction != (item.answer_den is not None) or item.answer_den == 0:
            rejected.append((item.id, "answer_shape"))
            continue
        if exercise.answer_den is not None and item.answer_den is not None:
            correct = item.answer * exercise.answer_den == exercise.answer * item.answer_den
        else:
            correct = item.answer == exercise.answer
        high = min(verified.expires_at, int(now))
        duration = item.duration_s
        if duration is not None and duration > MAX_DURATION_S:
            duration = None
        valid.append(
            (
                item.id,
                OfflineAttempt(
                    exercise_id=verified.exercise_id,
                    topic=verified.topic,
                    exercise=exercise.text,
                    correct=correct,
                    level=verified.level,
                    duration_s=duration,
                    answered_at=_clamp_time(item.answered_at, verified.issued_at, high),
                    local_day=_local_day(item.local_date, verified.issued_at, high),
                ),
            )
        )
    # Orden cronológico (estable a igual hora). La base vuelve a ordenar igual: es la regla.
    valid.sort(key=lambda pair: pair[1].answered_at)
    return valid, rejected


@router.post("/{student_id}/offline-sync")
async def sync_offline_attempts(
    body: SyncRequest, student: AuthorizedStudentDep, request: Request
) -> SyncOut:
    settings = request.app.state.settings
    key = signing_key(request)
    gateway: Gateway = request.app.state.gateway
    now = datetime.now(UTC).timestamp()

    valid, rejected = await run_in_threadpool(
        _prepare, key, student.student_id, body.attempts, settings.offline_sync_grace_seconds, now
    )
    for _, reason in rejected:
        # Un evento por rechazo, solo con el código: sirve de contador sin datos del niño.
        log_event(logger, "offline_sync.rejected", code=reason)

    statuses: dict[uuid.UUID, str] = {}
    if valid:
        try:
            result = await gateway.record_offline_attempts(
                student.tutor_id, student.student_id, [a for _, a in valid]
            )
        except GatewayError as exc:
            log_event(logger, "offline_sync.denied", stage="record", code=f"gateway_{exc.reason}")
            raise ApiError(503, "service_unavailable") from None
        if result is None:
            raise ApiError(403, "forbidden")
        statuses = result
        if any(s == "ok" for s in statuses.values()):
            try:
                await gateway.touch_student_activity(student.tutor_id, student.student_id)
            except GatewayError as exc:
                log_event(logger, "offline_sync.touch_failed", code=f"gateway_{exc.reason}")

    by_device: dict[uuid.UUID, Literal["accepted", "duplicate", "rejected"]] = {}
    for device_id, attempt in valid:
        status = statuses.get(attempt.exercise_id)
        if status is None:
            # La base no devolvió estado para un intento enviado: no se confirma (se reintenta).
            log_event(logger, "offline_sync.denied", stage="record", code="missing_status")
            raise ApiError(503, "service_unavailable")
        by_device[device_id] = "accepted" if status == "ok" else "duplicate"
    for device_id, _ in rejected:
        by_device[device_id] = "rejected"

    log_event(logger, "offline_sync.done", outcome="ok")
    return SyncOut(
        results=[SyncResultOut(id=item.id, status=by_device[item.id]) for item in body.attempts]
    )
