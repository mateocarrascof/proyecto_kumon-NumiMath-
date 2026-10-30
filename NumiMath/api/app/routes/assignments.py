"""Ejercicios propios del tutor ("Tareas de tu tutor").

- El tutor crea, lista y borra tareas de sus perfiles. El texto pasa por el filtro de entrada
  (`check_tutor_text`: datos personales, groserías y temas inapropiados) ANTES de
  guardarse. Nunca se envía a la IA.
- El niño recibe sus pendientes (`id`, `text`) y las ya hechas con su estado, NUNCA la respuesta,
  y responde con un número. Eso no pide PIN.
- Crear, borrar y la lista completa (con respuestas) son de la zona del tutor: piden el token
  parental (PIN verificado).
- Nunca se registra el texto: los logs llevan solo códigos.
Reglas: docs/SPEC.md ("Ejercicios propios").
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep, ParentalStudentDep, parental_key
from app.errors import ApiError
from app.exercises.tickets import issue_ticket, ticket_duration
from app.logging import get_logger, log_event
from app.safety.input_filter import Reason, check_tutor_text
from app.streaks import parse_local_day

router = APIRouter(prefix="/v1/students", tags=["assignments"])
logger = get_logger("mathtutor.assignments")

MAX_PENDING = 20
TUTOR_LIST_LIMIT = 50
KID_DONE_LIMIT = 20

# Mensajes para el ADULTO cuando el filtro rechaza el enunciado (sin repetir el texto).
_PII = "Quita datos personales, como nombres reales, teléfonos, correos o direcciones."
_WORDS = "Usa palabras aptas para niños de 6 a 10 años."
_MATH = "Revisa el enunciado: debe ser un ejercicio de matemáticas."
_REJECT: dict[Reason, str] = {
    "empty": "Escribe el enunciado del ejercicio.",
    "too_long": "El enunciado puede tener hasta 200 caracteres.",
    "pii": _PII,
    "profanity": _WORDS,
    "unsafe_topic": _WORDS,
    "needs_support": _WORDS,
    "prompt_injection": _MATH,
    "off_topic": _MATH,
}
_ALREADY = "Esta tarea ya estaba respondida."


class AssignmentCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: Annotated[str, Field(min_length=1, max_length=400)]
    answer: Annotated[int, Field(ge=0, le=1_000_000)]


class AssignmentAnswerIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    answer: Annotated[int, Field(ge=0, le=1_000_000)]
    local_date: date | None = None
    # Ticket de `/start` para medir el tiempo. Opcional: sin él se registra sin duración.
    ticket: Annotated[str | None, Field(max_length=400)] = None


class PendingOut(BaseModel):
    """Tarea pendiente para el niño: sin la respuesta."""

    id: uuid.UUID
    text: str


class DoneOut(BaseModel):
    """Tarea ya hecha para el niño: solo si acertó, sin la respuesta."""

    id: uuid.UUID
    text: str
    status: Literal["correct", "wrong"]


class KidTasksOut(BaseModel):
    pending: list[PendingOut]
    done: list[DoneOut]


class AssignmentOut(BaseModel):
    """Lo que ve el tutor."""

    id: uuid.UUID
    text: str
    answer: int
    status: Literal["pending", "correct", "wrong"]
    created_at: datetime
    answered_at: datetime | None


class TicketOut(BaseModel):
    ticket: str


class AnswerOut(BaseModel):
    correct: bool
    correct_answer: int


def _gateway(request: Request) -> Gateway:
    return request.app.state.gateway


def _unavailable(stage: str, exc: GatewayError) -> ApiError:
    log_event(logger, "assignment.denied", stage=stage, code=f"gateway_{exc.reason}")
    return ApiError(503, "service_unavailable")


@router.get("/{student_id}/assignments")
async def list_for_kid(student: AuthorizedStudentDep, request: Request) -> KidTasksOut:
    try:
        rows = await _gateway(request).list_assignments(
            student.tutor_id,
            student.student_id,
            pending_only=False,
            limit=MAX_PENDING + KID_DONE_LIMIT,
        )
    except GatewayError as exc:
        raise _unavailable("list", exc) from None
    return KidTasksOut(
        pending=[PendingOut(id=r.id, text=r.text) for r in rows if r.correct is None],
        done=[
            DoneOut(id=r.id, text=r.text, status="correct" if r.correct else "wrong")
            for r in rows
            if r.correct is not None
        ][:KID_DONE_LIMIT],
    )


@router.get("/{student_id}/assignments/all")
async def list_all(student: ParentalStudentDep, request: Request) -> list[AssignmentOut]:
    try:
        rows = await _gateway(request).list_assignments(
            student.tutor_id, student.student_id, pending_only=False, limit=TUTOR_LIST_LIMIT
        )
    except GatewayError as exc:
        raise _unavailable("list", exc) from None
    return [
        AssignmentOut(
            id=r.id,
            text=r.text,
            answer=r.answer,
            status="pending" if r.correct is None else ("correct" if r.correct else "wrong"),
            created_at=r.created_at,
            answered_at=r.answered_at,
        )
        for r in rows
    ]


@router.post("/{student_id}/assignments", status_code=201)
async def create(
    body: AssignmentCreate, student: ParentalStudentDep, request: Request
) -> dict[str, str]:
    check = check_tutor_text(body.text)
    if not check.allowed or not check.text:
        reason: Reason = check.reason or "off_topic"
        log_event(logger, "assignment.rejected", code=reason)
        raise ApiError(
            422, "assignment_rejected", message=_REJECT[reason], extra={"reason": reason}
        )
    try:
        outcome = await _gateway(request).create_assignment(
            student.tutor_id, student.student_id, check.text, body.answer
        )
    except GatewayError as exc:
        raise _unavailable("create", exc) from None
    if outcome == "limit":
        raise ApiError(
            409,
            "assignment_limit",
            message=f"Puedes tener hasta {MAX_PENDING} tareas pendientes por perfil.",
        )
    if outcome != "ok":
        raise ApiError(403, "forbidden")
    return {"status": "ok"}


@router.delete("/{student_id}/assignments/{assignment_id}", status_code=204)
async def delete(
    assignment_id: uuid.UUID, student: ParentalStudentDep, request: Request
) -> Response:
    try:
        outcome = await _gateway(request).delete_assignment(
            student.tutor_id, student.student_id, assignment_id
        )
    except GatewayError as exc:
        raise _unavailable("delete", exc) from None
    if outcome != "ok":
        raise ApiError(404, "not_found")
    return Response(status_code=204)


@router.post("/{student_id}/assignments/{assignment_id}/start")
async def start(
    assignment_id: uuid.UUID, student: AuthorizedStudentDep, request: Request
) -> TicketOut:
    """El niño abre una tarea: ticket firmado con la hora, para medir cuánto tarda."""
    return TicketOut(ticket=issue_ticket(parental_key(request), assignment_id, student.student_id))


@router.post("/{student_id}/assignments/{assignment_id}/answer")
async def answer(
    assignment_id: uuid.UUID,
    body: AssignmentAnswerIn,
    student: AuthorizedStudentDep,
    request: Request,
) -> AnswerOut:
    gateway = _gateway(request)
    try:
        result = await gateway.answer_assignment(
            student.tutor_id,
            student.student_id,
            assignment_id,
            body.answer,
            parse_local_day(body.local_date),
            _duration(request, body.ticket, assignment_id, student.student_id),
        )
    except GatewayError as exc:
        raise _unavailable("answer", exc) from None
    if result.status == "duplicate":
        raise ApiError(409, "already_answered", message=_ALREADY)
    if result.status != "ok":
        raise ApiError(404, "not_found")
    try:
        await gateway.touch_student_activity(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "assignment.touch_failed", code=f"gateway_{exc.reason}")
    return AnswerOut(correct=result.correct, correct_answer=result.answer)


def _duration(request: Request, ticket: str | None, assignment_id, student_id) -> int | None:  # type: ignore[no-untyped-def]
    """Segundos desde que abrió la tarea. Sin clave o sin ticket válido: sin duración."""
    key = request.app.state.settings.exercise_signing_key.get_secret_value()
    if not key:
        return None
    return ticket_duration(key.encode(), ticket, assignment_id, student_id)
