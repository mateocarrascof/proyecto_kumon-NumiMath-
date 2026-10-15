"""Práctica: temas, ejercicios firmados y corrección en el servidor.

Orden: JWT → perfil del tutor, no bloqueado y con consentimiento (AuthorizedStudentDep) →
curso leído de la base → tema válido para ese curso. Los ejercicios no usan IA ni cuota de
explicaciones. La respuesta del niño es solo un número: nunca texto libre.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.ai.topics import get_topic, topics_for_grade
from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.generators import GENERATORS
from app.exercises.tokens import InvalidExercise, issue, verify
from app.logging import get_logger, log_event

router = APIRouter(prefix="/v1/students", tags=["exercises"])
logger = get_logger("mathtutor.exercises")

_EXPIRED = "Este ejercicio ya no es válido. Pide uno nuevo."
_ALREADY = "Ya respondiste este ejercicio."


class TopicOut(BaseModel):
    id: str
    label: str


class ExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topic: Annotated[str, Field(min_length=1, max_length=60)]


class ExerciseOut(BaseModel):
    token: str
    topic: str
    text: str
    expires_in: int


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    token: Annotated[str, Field(min_length=10, max_length=600)]
    answer: Annotated[int, Field(ge=0, le=1_000_000)]


class AnswerOut(BaseModel):
    correct: bool
    correct_answer: int


def _key(request: Request) -> bytes:
    key = request.app.state.settings.exercise_signing_key.get_secret_value()
    if not key:
        # Falla cerrado: sin clave de firma no se emiten ni se corrigen ejercicios.
        log_event(logger, "exercise.denied", code="signing_key_missing")
        raise ApiError(503, "service_unavailable")
    return key.encode()


async def _grade(request: Request, tutor_id, student_id) -> int:  # type: ignore[no-untyped-def]
    gateway: Gateway = request.app.state.gateway
    try:
        grade = await gateway.get_student_grade(tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "exercise.denied", stage="grade", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if grade is None:
        raise ApiError(403, "forbidden")
    return grade


@router.get("/{student_id}/topics")
async def list_topics(student: AuthorizedStudentDep, request: Request) -> list[TopicOut]:
    grade = await _grade(request, student.tutor_id, student.student_id)
    return [TopicOut(id=t.id, label=t.label) for t in topics_for_grade(grade) if t.id in GENERATORS]


@router.post("/{student_id}/exercises")
async def create_exercise(
    body: ExerciseRequest, student: AuthorizedStudentDep, request: Request
) -> ExerciseOut:
    key = _key(request)
    grade = await _grade(request, student.tutor_id, student.student_id)
    if get_topic(grade, body.topic) is None:
        log_event(logger, "exercise.denied", stage="topic", code="topic_not_for_grade")
        raise ApiError(422, "invalid_request")
    ttl = request.app.state.settings.exercise_token_ttl_seconds
    issued = issue(key, student.student_id, body.topic, ttl)
    if issued is None:
        raise ApiError(422, "invalid_request")
    return ExerciseOut(
        token=issued.token, topic=issued.topic, text=issued.exercise.text, expires_in=ttl
    )


@router.post("/{student_id}/exercises/answer")
async def answer_exercise(
    body: AnswerRequest, student: AuthorizedStudentDep, request: Request
) -> AnswerOut:
    key = _key(request)
    gateway: Gateway = request.app.state.gateway
    try:
        verified = verify(key, body.token, student.student_id)
    except InvalidExercise:
        log_event(logger, "exercise.denied", stage="token", code="invalid_or_expired")
        raise ApiError(422, "exercise_invalid", message=_EXPIRED) from None

    correct = body.answer == verified.exercise.answer
    try:
        outcome = await gateway.record_attempt(
            student.tutor_id,
            student.student_id,
            verified.exercise_id,
            verified.topic,
            verified.exercise.text,
            correct,
        )
    except GatewayError as exc:
        log_event(logger, "exercise.denied", stage="record", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome == "duplicate":
        raise ApiError(409, "already_answered", message=_ALREADY)
    if outcome != "ok":
        raise ApiError(403, "forbidden")

    try:
        await gateway.touch_student_activity(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "exercise.touch_failed", code=f"gateway_{exc.reason}")
    return AnswerOut(correct=correct, correct_answer=verified.exercise.answer)
