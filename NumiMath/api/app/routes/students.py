"""Rutas por perfil.

Las de uso pasan por `AuthorizedStudentDep`. Borrar un perfil es de la zona del tutor: pide el
token parental (PIN verificado) y NO exige consentimiento vigente ni perfil desbloqueado, porque
suprimir los datos es un derecho del titular. Reglas: docs/SPEC.md ("Perfiles").
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, Response

from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep, ParentalTutorDep
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
