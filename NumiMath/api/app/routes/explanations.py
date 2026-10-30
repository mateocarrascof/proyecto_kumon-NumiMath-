"""Explicaciones por streaming (SSE).

Orden de las comprobaciones (ADR 0001):
  1. JWT válido                                        → 401
  2. perfil del tutor, no bloqueado, consentimiento    → 403 / 503   (AuthorizedStudentDep)
  3. curso del perfil (leído de la base) y tema válido → 403 / 422
  4. filtro de entrada sobre el texto del niño         → 422 con mensaje amable
  5. cuota por perfil y por tutor                      → 429 / 503
  6. proveedor de IA → filtro de salida → SSE          (con re-chequeo cada pocos segundos)

Nota: el filtro de entrada va ANTES de consumir cuota (el ADR numera la cuota primero). Es
deliberado: un mensaje rechazado no cuesta nada ni gasta la cuota del niño; el filtro es local
y no toca la base.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.ai.prompt import InvalidPrompt, build_prompt
from app.ai.provider import AIProvider
from app.ai.topics import get_topic
from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.safety.input_filter import CHILD_MESSAGES, check_input
from app.streaming.pipeline import StreamConfig, stream_explanation
from app.usage.limits import UsagePolicy, consume_usage

router = APIRouter(prefix="/v1/students", tags=["explanations"])
logger = get_logger("mathtutor.explanations")


class ExplanationRequest(BaseModel):
    # Cualquier campo extra (p. ej. un "grade" enviado por el cliente) se ignora: el curso sale
    # de la base.
    model_config = ConfigDict(extra="ignore")

    topic: Annotated[str, Field(min_length=1, max_length=60)]
    exercise: Annotated[str, Field(min_length=1, max_length=1000)]


@router.post("/{student_id}/explanations")
async def create_explanation(
    body: ExplanationRequest, student: AuthorizedStudentDep, request: Request
) -> StreamingResponse:
    state = request.app.state
    gateway: Gateway = state.gateway
    provider: AIProvider = state.ai_provider
    settings = state.settings

    # 3. Curso (de la base) y tema válido para ese curso.
    try:
        grade = await gateway.get_student_grade(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "explanation.denied", stage="grade", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if grade is None:
        raise ApiError(403, "forbidden")
    if get_topic(grade, body.topic) is None:
        log_event(logger, "explanation.denied", stage="topic", code="topic_not_for_grade")
        raise ApiError(422, "invalid_request")

    # 4. Filtro de entrada.
    checked = check_input(body.exercise)
    if not checked.allowed and checked.reason is not None:
        log_event(logger, "explanation.denied", stage="input", code=checked.reason)
        raise ApiError(
            422,
            "input_rejected",
            message=CHILD_MESSAGES[checked.reason],
            extra={"reason": checked.reason},
        )

    # 5. Cuota.
    await consume_usage(gateway, student, UsagePolicy.from_settings(settings))

    try:
        prompt = build_prompt(grade, body.topic, checked)
    except InvalidPrompt:
        # No debería ocurrir (ya validado arriba); si ocurre, se deniega.
        raise ApiError(422, "invalid_request") from None

    # Marca de actividad: mejor esfuerzo, no afecta la respuesta.
    try:
        await gateway.touch_student_activity(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "explanation.touch_failed", code=f"gateway_{exc.reason}")

    stream = stream_explanation(
        provider=provider,
        prompt=prompt,
        gateway=gateway,
        student=student,
        config=StreamConfig(
            max_seconds=float(settings.stream_max_seconds),
            recheck_seconds=float(settings.stream_recheck_seconds),
        ),
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",  # que un proxy no acumule los eventos
        },
    )
