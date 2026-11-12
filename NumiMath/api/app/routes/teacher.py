"""Zona del docente: su propio perfil (D3, "Mi código de vínculo").

El docente ve solo su nombre y su código. Nunca datos de niños: un docente solo accede a un niño con
un vínculo activo, y eso pasa siempre por `teacher_can_view` (no hay ninguna ruta de niños aquí).
`CurrentTeacher` ya comprobó que el perfil existe (un docente eliminado con un token aún vigente
recibe 403).
Reglas: docs/SPEC.md ("Docentes y administradores").
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.db.gateway import TeacherProfile
from app.deps import CurrentTeacher

router = APIRouter(prefix="/v1/teacher", tags=["teacher"])


class TeacherMe(BaseModel):
    name: str
    link_code: str


@router.get("/me")
async def my_profile(_: CurrentTeacher, request: Request, response: Response) -> TeacherMe:
    profile: TeacherProfile = request.state.teacher_profile
    response.headers["Cache-Control"] = "no-store"
    return TeacherMe(name=profile.name, link_code=profile.link_code)
