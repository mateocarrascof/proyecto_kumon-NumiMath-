"""Rutas por perfil.

Las de uso pasan por `AuthorizedStudentDep`. Borrar un perfil es de la zona del tutor: pide el
token parental (PIN verificado) y NO exige consentimiento vigente ni perfil desbloqueado, porque
suprimir los datos es un derecho del titular. Reglas: docs/SPEC.md ("Perfiles").
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel

from app.ai.topics import ASSIGNMENT_TOPIC, topic_label
from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep, ParentalStudentDep, ParentalTutorDep
from app.errors import ApiError
from app.logging import get_logger, log_event

router = APIRouter(prefix="/v1/students", tags=["students"])
logger = get_logger("mathtutor.students")


@router.get("/{student_id}/access")
async def check_access(student: AuthorizedStudentDep) -> dict[str, bool]:
    """200 si el tutor autenticado puede usar este perfil ahora; si no, 403/503 genéricos."""
    return {"authorized": True}


@router.delete("/{student_id}", status_code=204)
async def delete_student(
    student_id: uuid.UUID, tutor: ParentalTutorDep, request: Request
) -> Response:
    """Borra el perfil y, en cascada, su progreso, racha y tareas (la declaración se archiva)."""
    gateway: Gateway = request.app.state.gateway
    try:
        outcome = await gateway.delete_student(tutor.tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "student.delete_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome != "ok":
        raise ApiError(404, "not_found")
    log_event(logger, "student.deleted")
    return Response(status_code=204)


class AttemptOut(BaseModel):
    label: str
    tutor_task: bool
    correct: bool
    level: int
    answered_at: datetime


class AttemptsOut(BaseModel):
    items: list[AttemptOut]
    has_more: bool
    next_offset: int | None


@router.get("/{student_id}/history")
async def student_history(
    student: ParentalStudentDep,
    request: Request,
    response: Response,
    offset: Annotated[int, Query(ge=0, le=5_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 30,
) -> AttemptsOut:
    """T5: intentos de práctica del hijo (habilidad, resultado, nivel y hora), paginados. Zona del
    tutor: pide el token del PIN. No incluye enunciados ni diagnóstico."""
    response.headers["Cache-Control"] = "no-store"
    gateway: Gateway = request.app.state.gateway
    try:
        page = await gateway.list_student_attempts(
            student.tutor_id, student.student_id, offset, limit
        )
    except GatewayError as exc:
        log_event(logger, "student.history_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if page is None:
        raise ApiError(403, "forbidden")
    return AttemptsOut(
        items=[
            AttemptOut(
                label=topic_label(0, a.topic),
                tutor_task=a.topic == ASSIGNMENT_TOPIC,
                correct=a.correct,
                level=a.level,
                answered_at=a.answered_at,
            )
            for a in page.items
        ],
        has_more=page.has_more,
        next_offset=offset + len(page.items) if page.has_more else None,
    )
