"""Zona del administrador: cuentas de docentes (AD2 crear, AD3 listar).

El administrador gestiona cuentas de ADULTOS. Nunca ve datos de niños ni hojas: ninguna ruta de
aquí lee tablas de niños.

- Crear: la contraseña inicial la escribe el administrador (mínimo 8). Se envía a Auth y se
  devuelve UNA sola vez en esta respuesta (`Cache-Control: no-store`); no se guarda en la base ni
  se registra en logs. Si el correo ya tiene cuenta, no se crea nada (409). Si falla el guardado
  del perfil tras crear el usuario en Auth, se borra ese usuario (compensación) y se responde 503.
- Cada alta queda en `admin_audit` (quién, qué, cuándo; sin correo ni nombre), en la misma
  transacción que el perfil del docente.
Reglas: docs/SPEC.md ("Docentes y administradores").
"""

from __future__ import annotations

import re
import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth.admin import AuthAdmin, AuthAdminError
from app.db.gateway import Gateway, GatewayError
from app.deps import CurrentAdmin
from app.errors import ApiError
from app.logging import get_logger, log_event

router = APIRouter(prefix="/v1/admin/teachers", tags=["admin"])
logger = get_logger("mathtutor.admin")

PASSWORD_MIN = 8
PASSWORD_MAX = 72  # límite de bcrypt en Auth
# 8 caracteres A-Z y 2-9 sin letras ambiguas (I, O); coincide con el CHECK de `teachers.link_code`.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_ATTEMPTS = 5
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Honesto: tras un corte de red puede que la cuenta sí se haya creado (se avisa al administrador).
_UNAVAILABLE = (
    "No pudimos completar la operación. Revisa la lista de docentes antes de reintentar: "
    "si el correo aparece, la cuenta ya existe."
)


class TeacherCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: Annotated[str, Field(max_length=200)]
    email: Annotated[str, Field(max_length=254)]
    password: Annotated[str, Field(max_length=200)]


class TeacherOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    link_code: str


class TeacherCreated(TeacherOut):
    # Se muestra UNA vez, para que la empresa se la entregue al docente.
    password: str


class TeacherList(BaseModel):
    teachers: list[TeacherOut]


def new_link_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))


def _invalid(message: str) -> ApiError:
    return ApiError(422, "invalid_request", message=message)


def _validate(body: TeacherCreate) -> tuple[str, str]:
    name = body.name.strip()
    email = body.email.strip().lower()
    if not 1 <= len(name) <= 60:
        raise _invalid("El nombre debe tener entre 1 y 60 caracteres.")
    if not _EMAIL.match(email):
        raise _invalid("Escribe un correo válido.")
    if (
        not PASSWORD_MIN <= len(body.password) <= PASSWORD_MAX
        or len(body.password.encode()) > PASSWORD_MAX
    ):
        raise _invalid(
            f"La contraseña inicial debe tener entre {PASSWORD_MIN} y {PASSWORD_MAX} caracteres."
        )
    return name, email


@router.get("")
async def list_teachers(_: CurrentAdmin, request: Request, response: Response) -> TeacherList:
    gateway: Gateway = request.app.state.gateway
    response.headers["Cache-Control"] = "no-store"
    try:
        rows = await gateway.admin_list_teachers()
    except GatewayError as exc:
        log_event(logger, "admin.list_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    return TeacherList(
        teachers=[
            TeacherOut(id=r.id, name=r.name, email=r.email, link_code=r.link_code) for r in rows
        ]
    )


@router.post("", status_code=201)
async def create_teacher(
    body: TeacherCreate, admin: CurrentAdmin, request: Request, response: Response
) -> TeacherCreated:
    name, email = _validate(body)
    gateway: Gateway = request.app.state.gateway
    auth_admin: AuthAdmin = request.app.state.auth_admin

    try:
        teacher_id = await auth_admin.create_user(email, body.password, "teacher")
    except AuthAdminError as exc:
        if exc.reason == "email_exists":
            log_event(logger, "admin.create_rejected", code="email_taken")
            raise ApiError(
                409,
                "email_taken",
                message="Ese correo ya tiene una cuenta. No se creó nada.",
            ) from None
        log_event(logger, "admin.create_failed", stage="auth", code=exc.reason)
        raise ApiError(503, "service_unavailable", message=_UNAVAILABLE) from None

    code = ""
    try:
        for _ in range(_CODE_ATTEMPTS):
            code = new_link_code()
            if await gateway.admin_create_teacher(admin.tutor_id, teacher_id, name, code) == "ok":
                break
        else:
            raise GatewayError("code_exhausted")
    except GatewayError as exc:
        log_event(logger, "admin.create_failed", stage="profile", code=exc.reason)
        # Compensación: no dejar una cuenta de Auth sin perfil de docente.
        try:
            await auth_admin.delete(teacher_id)
        except AuthAdminError as cleanup:
            log_event(logger, "admin.cleanup_failed", code=cleanup.reason)
        raise ApiError(503, "service_unavailable", message=_UNAVAILABLE) from None

    log_event(logger, "admin.teacher_created")
    response.headers["Cache-Control"] = "no-store"
    return TeacherCreated(
        id=teacher_id, name=name, email=email, link_code=code, password=body.password
    )
