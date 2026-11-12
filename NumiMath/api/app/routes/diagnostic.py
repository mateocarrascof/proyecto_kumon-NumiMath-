"""Diagnóstico inicial de una habilidad (CU-A2).

Prueba corta y opcional antes de la primera práctica de una habilidad: 6 ejercicios (2 por nivel,
en orden creciente) que estiman el nivel de entrada.

- Cada ejercicio lo genera código determinista y va firmado (dominio propio del diagnóstico, ver
  `tokens.py`). El nivel de cada paso lo fija el servidor: el cliente solo dice qué paso pide.
- Las respuestas se envían JUNTAS al final. Si el niño abandona, no llega nada: la habilidad
  sigue sin intentos (nivel 1) y la prueba se puede volver a ofrecer (excepción de la ficha).
- La corrección es del servidor. Se guarda en una sola transacción (`save_diagnostic`) como
  intentos con activity = 'diagnostic', que NO cuentan para el bloque, la racha ni el informe.
- Mismo orden de comprobaciones que la práctica (JWT → perfil del tutor, no bloqueado y con
  consentimiento → curso → habilidad del curso). No usa IA.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.ai.topics import get_topic
from app.db.gateway import DiagnosticItem, Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.diagnostic import STEPS, entry_level, level_for_step
from app.exercises.tokens import InvalidExercise, VerifiedExercise, issue, verify
from app.logging import get_logger, log_event
from app.routes.exercises import _grade, _key

router = APIRouter(prefix="/v1/students", tags=["diagnostic"])
logger = get_logger("mathtutor.diagnostic")

_EXPIRED = "Esta prueba ya no es válida."


class DiagnosticExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topic: Annotated[str, Field(min_length=1, max_length=60)]
    step: Annotated[int, Field(ge=0, lt=STEPS)]


class DiagnosticExerciseOut(BaseModel):
    token: str
    topic: str
    text: str
    level: int
    step: int
    steps: int = STEPS
    expires_in: int
    answer_kind: Literal["integer", "fraction"] = "integer"


class DiagnosticAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    token: Annotated[str, Field(min_length=10, max_length=600)]
    answer: Annotated[int, Field(ge=0, le=1_000_000)]
    answer_den: Annotated[int, Field(ge=1, le=1000)] | None = None


class DiagnosticRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topic: Annotated[str, Field(min_length=1, max_length=60)]
    answers: Annotated[list[DiagnosticAnswer], Field(min_length=STEPS, max_length=STEPS)]


class DiagnosticOut(BaseModel):
    level: int


async def _check_topic(request: Request, tutor_id: uuid.UUID, student_id: uuid.UUID, topic: str):  # type: ignore[no-untyped-def]
    grade = await _grade(request, tutor_id, student_id)
    if get_topic(grade, topic) is None:
        log_event(logger, "diagnostic.denied", stage="topic", code="topic_not_for_grade")
        raise ApiError(422, "invalid_request")


@router.post("/{student_id}/diagnostic/exercises")
async def create_diagnostic_exercise(
    body: DiagnosticExerciseRequest, student: AuthorizedStudentDep, request: Request
) -> DiagnosticExerciseOut:
    key = _key(request)
    await _check_topic(request, student.tutor_id, student.student_id, body.topic)
    gateway: Gateway = request.app.state.gateway
    # Solo antes de la primera práctica: si la habilidad ya tiene progreso, no hay diagnóstico.
    # Falla cerrado: sin poder leer el progreso no se ofrece (la práctica sigue en nivel 1).
    try:
        progress = await gateway.list_skill_progress(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "diagnostic.denied", stage="progress", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if body.topic in progress:
        raise ApiError(409, "diagnostic_not_available")
    level = level_for_step(body.step)
    ttl = request.app.state.settings.exercise_token_ttl_seconds
    issued = issue(key, student.student_id, body.topic, ttl, level=level, step=body.step)
    if issued is None:
        raise ApiError(422, "invalid_request")
    return DiagnosticExerciseOut(
        token=issued.token,
        topic=issued.topic,
        text=issued.exercise.text,
        level=issued.level,
        step=body.step,
        expires_in=ttl,
        answer_kind="fraction" if issued.exercise.is_fraction else "integer",
    )


def _is_correct(verified: VerifiedExercise, answer: DiagnosticAnswer) -> bool:
    """Misma corrección que la práctica: fracciones equivalentes cuentan como correctas."""
    exercise = verified.exercise
    if exercise.is_fraction != (answer.answer_den is not None):
        raise ApiError(422, "invalid_request")
    if exercise.answer_den is not None and answer.answer_den is not None:
        return answer.answer * exercise.answer_den == exercise.answer * answer.answer_den
    return answer.answer == exercise.answer


@router.post("/{student_id}/diagnostic")
async def submit_diagnostic(
    body: DiagnosticRequest, student: AuthorizedStudentDep, request: Request
) -> DiagnosticOut:
    key = _key(request)
    await _check_topic(request, student.tutor_id, student.student_id, body.topic)

    by_step: dict[int, tuple[VerifiedExercise, DiagnosticAnswer]] = {}
    for answer in body.answers:
        try:
            verified = verify(key, answer.token, student.student_id, diagnostic=True)
        except InvalidExercise:
            # Alterado, vencido (10 min) o de otro perfil: no se guarda nada y la habilidad
            # queda en nivel 1, igual que si el niño hubiera abandonado.
            log_event(logger, "diagnostic.denied", stage="token", code="invalid_or_expired")
            raise ApiError(422, "exercise_invalid", message=_EXPIRED) from None
        step = verified.step
        # Los 6 pasos, cada uno una vez, todos del mismo tema y con el nivel que le toca a su
        # paso: así nadie arma una prueba con 6 ejercicios de nivel 3 ni repite uno ya acertado.
        if (
            step is None
            or step in by_step
            or verified.topic != body.topic
            or verified.level != level_for_step(step)
        ):
            log_event(logger, "diagnostic.denied", stage="steps", code="bad_steps")
            raise ApiError(422, "invalid_request")
        by_step[step] = (verified, answer)

    items: list[DiagnosticItem] = []
    correct_by_step: list[bool] = []
    for step in range(STEPS):
        verified, answer = by_step[step]
        correct = _is_correct(verified, answer)
        correct_by_step.append(correct)
        items.append(
            DiagnosticItem(verified.exercise_id, verified.exercise.text, correct, verified.level)
        )
    level = entry_level(correct_by_step)

    gateway: Gateway = request.app.state.gateway
    try:
        outcome = await gateway.save_diagnostic(
            student.tutor_id, student.student_id, body.topic, level, items
        )
    except GatewayError as exc:
        log_event(logger, "diagnostic.denied", stage="save", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome == "not_available":
        raise ApiError(409, "diagnostic_not_available")
    if outcome != "ok":
        raise ApiError(403, "forbidden")

    try:
        await gateway.touch_student_activity(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "diagnostic.touch_failed", code=f"gateway_{exc.reason}")
    # Solo el código del evento: nunca enunciados, respuestas ni el nivel del niño.
    log_event(logger, "diagnostic.saved")
    return DiagnosticOut(level=level)
