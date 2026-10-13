"""Rutas por perfil. Toda ruta con `{student_id}` pasa por `AuthorizedStudentDep`."""

from __future__ import annotations

from fastapi import APIRouter

from app.deps import AuthorizedStudentDep

router = APIRouter(prefix="/v1/students", tags=["students"])


@router.get("/{student_id}/access")
async def check_access(student: AuthorizedStudentDep) -> dict[str, bool]:
    """200 si el tutor autenticado puede usar este perfil ahora; si no, 403/503 genéricos."""
    return {"authorized": True}
