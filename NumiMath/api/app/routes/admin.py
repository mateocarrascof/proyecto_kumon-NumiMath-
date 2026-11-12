"""Zona del administrador: cuentas de docentes (AD2 crear, AD3 listar).

El administrador gestiona cuentas de ADULTOS. Nunca ve datos de niños ni hojas: ninguna ruta de
aquí lee tablas de niños.

- Crear: la contraseña inicial la escribe el administrador (mínimo 8). Se envía a Auth y se
  devuelve UNA sola vez en esta respuesta (`Cache-Control: no-store`); no se guarda en la base ni
  se registra en logs. Si el correo ya tiene cuenta, no se crea nada (409). Si falla el guardado
  del perfil tras crear el usuario en Auth, se borra ese usuario (compensación) y se responde 503.
- Editar (AD4): nombre y/o correo; el código y los vínculos no cambian. El correo se cambia en Auth
  al instante, sin correo de confirmación, y se cierran sus sesiones. Sin cambios no se hace nada ni
  se registra. Si falla el guardado del nombre tras cambiar el correo, el correo se revierte.
- Eliminar (AD5): se borra la cuenta de Auth (el docente deja de poder entrar; su perfil y sus
  vínculos caen por cascada) y después se registra la baja. Los datos de los niños no se tocan.
- Cada cambio queda en `admin_audit` (quién, qué, cuándo; sin correo ni nombre), en la misma
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


_UPDATE_FAILED = (
    "No pudimos guardar los cambios. Revisa los datos del docente y vuelve a intentarlo."
)


# Si no se pudo ni revertir el correo, puede que el cambio sí haya quedado aplicado.
_UPDATE_MAYBE_APPLIED = (
    "No pudimos confirmar los cambios: el correo pudo haberse cambiado. "
    "Revisa la lista de docentes antes de volver a intentarlo."
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


def _clean_name(raw: str) -> str:
    name = raw.strip()
    if not 1 <= len(name) <= 60:
        raise _invalid("El nombre debe tener entre 1 y 60 caracteres.")
    return name


def _clean_email(raw: str) -> str:
    email = raw.strip().lower()
    if not _EMAIL.match(email):
        raise _invalid("Escribe un correo válido.")
    return email


def _validate(body: TeacherCreate) -> tuple[str, str]:
    name = _clean_name(body.name)
    email = _clean_email(body.email)
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


class TeacherUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: Annotated[str | None, Field(max_length=200)] = None
    email: Annotated[str | None, Field(max_length=254)] = None


class TeacherUpdated(TeacherOut):
    changed: bool


@router.patch("/{teacher_id}")
async def update_teacher(
    teacher_id: uuid.UUID,
    body: TeacherUpdate,
    admin: CurrentAdmin,
    request: Request,
    response: Response,
) -> TeacherUpdated:
    gateway: Gateway = request.app.state.gateway
    auth_admin: AuthAdmin = request.app.state.auth_admin
    response.headers["Cache-Control"] = "no-store"
    name = _clean_name(body.name) if body.name is not None else None
    email = _clean_email(body.email) if body.email is not None else None

    try:
        current = await gateway.admin_get_teacher(teacher_id)
    except GatewayError as exc:
        log_event(logger, "admin.update_failed", stage="read", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if current is None:
        raise ApiError(404, "not_found", message="Ese docente no existe.")

    new_name = name if name is not None else current.name
    old_email = current.email.lower()
    new_email = email if email is not None else old_email
    email_changed = new_email != old_email
    if new_name == current.name and not email_changed:
        return TeacherUpdated(
            id=current.id,
            name=current.name,
            email=current.email,
            link_code=current.link_code,
            changed=False,
        )

    if email_changed:
        taken = ApiError(
            409, "email_taken", message="Ese correo ya lo usa otra cuenta. No se cambió nada."
        )
        try:
            # Antes de tocar Auth: su API de administración responde un error genérico (500) al
            # chocar con un correo ajeno.
            if await gateway.admin_email_in_use(new_email, teacher_id):
                log_event(logger, "admin.update_rejected", code="email_taken")
                raise taken
        except GatewayError as exc:
            log_event(logger, "admin.update_failed", stage="check", code=f"gateway_{exc.reason}")
            raise ApiError(503, "service_unavailable", message=_UPDATE_FAILED) from None
        try:
            await auth_admin.update_email(teacher_id, new_email)
        except AuthAdminError as exc:
            if exc.reason == "email_exists":
                log_event(logger, "admin.update_rejected", code="email_taken")
                raise taken from None
            log_event(logger, "admin.update_failed", stage="auth", code=exc.reason)
            raise ApiError(503, "service_unavailable", message=_UPDATE_FAILED) from None

    try:
        result = await gateway.admin_update_teacher(
            admin.tutor_id, teacher_id, new_name, email_changed
        )
        if result == "not_found":
            raise GatewayError("not_found")
    except GatewayError as exc:
        log_event(logger, "admin.update_failed", stage="profile", code=exc.reason)
        reverted = True
        if email_changed:
            # Compensación: dejar el correo como estaba.
            try:
                await auth_admin.update_email(teacher_id, old_email)
            except AuthAdminError as revert:
                reverted = False
                log_event(logger, "admin.revert_failed", code=revert.reason)
        raise ApiError(
            503,
            "service_unavailable",
            message=_UPDATE_FAILED if reverted else _UPDATE_MAYBE_APPLIED,
        ) from None

    if email_changed:
        # Quien tenía la sesión abierta con el correo anterior no puede renovarla. Si falla, el
        # cambio ya está hecho: se deja constancia en el log para que alguien lo revise.
        try:
            await gateway.admin_revoke_teacher_sessions(admin.tutor_id, teacher_id)
        except GatewayError as exc:
            log_event(logger, "admin.sessions_revoke_failed", code=f"gateway_{exc.reason}")
    log_event(logger, "admin.teacher_updated")
    return TeacherUpdated(
        id=current.id, name=new_name, email=new_email, link_code=current.link_code, changed=True
    )


@router.delete("/{teacher_id}", status_code=204)
async def delete_teacher(teacher_id: uuid.UUID, admin: CurrentAdmin, request: Request) -> Response:
    gateway: Gateway = request.app.state.gateway
    auth_admin: AuthAdmin = request.app.state.auth_admin
    try:
        current = await gateway.admin_get_teacher(teacher_id)
    except GatewayError as exc:
        log_event(logger, "admin.delete_failed", stage="read", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if current is None:
        raise ApiError(404, "not_found", message="Ese docente no existe.")

    try:
        # Borra la cuenta de verdad: el perfil y los vínculos caen por cascada; los datos de los
        # niños no se tocan. Desde aquí el docente no puede volver a entrar.
        outcome = await auth_admin.delete(teacher_id)
    except AuthAdminError as exc:
        log_event(logger, "admin.delete_failed", stage="auth", code=exc.reason)
        raise ApiError(
            503,
            "service_unavailable",
            message="No pudimos eliminar la cuenta. Revisa la lista y vuelve a intentarlo.",
        ) from None
    if outcome == "not_found":
        raise ApiError(404, "not_found", message="Ese docente no existe.")

    try:
        await gateway.admin_record_teacher_deleted(admin.tutor_id, teacher_id)
    except GatewayError as exc:
        # La cuenta ya se borró y no se puede deshacer: se avisa por log, sin fallar la respuesta.
        log_event(logger, "admin.audit_failed", code=f"gateway_{exc.reason}")
    log_event(logger, "admin.teacher_deleted")
    return Response(status_code=204)
