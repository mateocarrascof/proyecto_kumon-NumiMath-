"""Práctica: habilidades, ejercicios firmados y corrección en el servidor.

Orden: JWT → perfil del tutor, no bloqueado y con consentimiento (AuthorizedStudentDep) →
curso leído de la base → habilidad practicable para ese curso (fase A, de su curso o anteriores).
Los ejercicios no usan IA ni cuota de explicaciones. La respuesta del niño es solo un número (o
numerador y denominador en fracciones): nunca texto libre.

Dominio: el nivel (1 a 3) sale de `student_skill_progress` (bloques de 10, ver `levels.py`) y va
firmado en el token. Dentro del bloque en curso no se repiten enunciados mientras haya otros.
"""

from __future__ import annotations

import uuid
from datetime import date
from math import gcd
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.ai.topics import get_topic, topics_for_grade
from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.generators import GENERATORS
from app.exercises.levels import BLOCK_SIZE, SkillProgress
from app.exercises.tickets import duration_since
from app.exercises.tokens import InvalidExercise, IssuedExercise, issue, verify
from app.logging import get_logger, log_event
from app.streaks import parse_local_day

router = APIRouter(prefix="/v1/students", tags=["exercises"])
logger = get_logger("mathtutor.exercises")

_EXPIRED = "Este ejercicio ya no es válido. Pide uno nuevo."
_ALREADY = "Ya respondiste este ejercicio."


# Intentos para encontrar un enunciado que no esté en el bloque en curso.
_FRESH_TRIES = 20


class TopicOut(BaseModel):
    id: str
    label: str
    module: str
    grade: int
    review: bool  # habilidad de un curso anterior (repaso)
    level: int
    block_done: int
    block_size: int = BLOCK_SIZE
    mastered: bool


class ExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topic: Annotated[str, Field(min_length=1, max_length=60)]


class ExerciseOut(BaseModel):
    token: str
    topic: str
    text: str
    level: int
    expires_in: int
    answer_kind: Literal["integer", "fraction"] = "integer"
    block_done: int = 0  # ejercicios ya respondidos del bloque en curso
    block_size: int = BLOCK_SIZE
    mastered: bool = False


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    token: Annotated[str, Field(min_length=10, max_length=600)]
    answer: Annotated[int, Field(ge=0, le=1_000_000)]
    # Solo en ejercicios de fracciones: denominador de la respuesta (el numerador va en `answer`).
    answer_den: Annotated[int, Field(ge=1, le=1000)] | None = None
    # Fecha local del dispositivo (YYYY-MM-DD) para la racha diaria. Opcional: si falta o no es
    # creíble, el intento se registra igual y la racha no cambia.
    local_date: date | None = None


class AnswerOut(BaseModel):
    correct: bool
    correct_answer: int
    correct_answer_den: int | None = None
    # Fracción correcta pero sin simplificar: la forma simple, para mostrarla (no es un error).
    simplified_num: int | None = None
    simplified_den: int | None = None


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
    progress = await _progress(request, student.tutor_id, student.student_id)
    out: list[TopicOut] = []
    for t in topics_for_grade(grade):
        if t.id not in GENERATORS:
            continue
        p = progress.get(t.id, SkillProgress())
        out.append(
            TopicOut(
                id=t.id,
                label=t.label,
                module=t.module,
                grade=t.grade,
                review=t.grade < grade,
                level=p.level,
                block_done=p.block_total,
                mastered=p.mastered,
            )
        )
    return out


@router.post("/{student_id}/exercises")
async def create_exercise(
    body: ExerciseRequest, student: AuthorizedStudentDep, request: Request
) -> ExerciseOut:
    key = _key(request)
    grade = await _grade(request, student.tutor_id, student.student_id)
    if get_topic(grade, body.topic) is None:
        log_event(logger, "exercise.denied", stage="topic", code="topic_not_for_grade")
        raise ApiError(422, "invalid_request")
    all_progress = await _progress(request, student.tutor_id, student.student_id)
    progress = all_progress.get(body.topic, SkillProgress())
    seen = await _block_texts(request, student.tutor_id, student.student_id, body.topic, progress)
    ttl = request.app.state.settings.exercise_token_ttl_seconds
    issued = _issue_fresh(key, student.student_id, body.topic, ttl, progress.level, seen)
    if issued is None:
        raise ApiError(422, "invalid_request")
    return ExerciseOut(
        token=issued.token,
        topic=issued.topic,
        text=issued.exercise.text,
        level=issued.level,
        expires_in=ttl,
        answer_kind="fraction" if issued.exercise.is_fraction else "integer",
        block_done=progress.block_total,
        mastered=progress.mastered,
    )


def _issue_fresh(
    key: bytes, student_id: uuid.UUID, topic: str, ttl: int, level: int, seen: set[str]
) -> IssuedExercise | None:
    """Emite un ejercicio cuyo enunciado no esté en el bloque en curso. Si la habilidad tiene
    pocos enunciados posibles en ese nivel y se agotan, se acepta uno repetido."""
    issued = None
    for _ in range(_FRESH_TRIES):
        issued = issue(key, student_id, topic, ttl, level=level)
        if issued is None or issued.exercise.text not in seen:
            return issued
    return issued


async def _progress(
    request: Request, tutor_id: uuid.UUID, student_id: uuid.UUID
) -> dict[str, SkillProgress]:
    """Progreso por habilidad. Mejor esfuerzo: si la base falla, todo en nivel 1."""
    gateway: Gateway = request.app.state.gateway
    try:
        return await gateway.list_skill_progress(tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "exercise.level_fallback", code=f"gateway_{exc.reason}")
        return {}


async def _block_texts(
    request: Request,
    tutor_id: uuid.UUID,
    student_id: uuid.UUID,
    topic: str,
    progress: SkillProgress,
) -> set[str]:
    """Enunciados del bloque en curso (los últimos `block_total` intentos de la habilidad).
    Mejor esfuerzo: si la base falla, no se evita repetir."""
    if progress.block_total == 0:
        return set()
    gateway: Gateway = request.app.state.gateway
    try:
        texts = await gateway.list_recent_exercises(
            tutor_id, student_id, topic, progress.block_total
        )
    except GatewayError as exc:
        log_event(logger, "exercise.recent_fallback", code=f"gateway_{exc.reason}")
        return set()
    return set(texts)


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

    exercise = verified.exercise
    if exercise.is_fraction != (body.answer_den is not None):
        # Una fracción sin denominador, o un denominador donde no corresponde.
        raise ApiError(422, "invalid_request")
    if exercise.answer_den is not None and body.answer_den is not None:
        # Fracciones equivalentes cuentan como correctas (6/10 = 3/5).
        correct = body.answer * exercise.answer_den == exercise.answer * body.answer_den
    else:
        correct = body.answer == exercise.answer
    try:
        outcome = await gateway.record_attempt(
            student.tutor_id,
            student.student_id,
            verified.exercise_id,
            verified.topic,
            verified.exercise.text,
            correct,
            parse_local_day(body.local_date),
            verified.level,
            duration_since(verified.issued_at),
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
    out = AnswerOut(
        correct=correct,
        correct_answer=exercise.answer,
        correct_answer_den=exercise.answer_den,
    )
    if correct and body.answer_den is not None:
        common = gcd(body.answer, body.answer_den)
        if common > 1:
            out.simplified_num = body.answer // common
            out.simplified_den = body.answer_den // common
    return out
