"""Dependencias de FastAPI compartidas por las rutas."""

from __future__ import annotations

import uuid
from typing import Annotated

import anyio.to_thread
from fastapi import Depends, Request

from app.access.authorize import AuthorizedStudent, authorize_student
from app.auth.jwt import AuthenticatedTutor, InvalidToken, TokenVerifier
from app.db.gateway import Gateway, GatewayError
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.parental import InvalidParentalToken, verify_parental_token

logger = get_logger("mathtutor.auth")


async def _authenticate(request: Request) -> AuthenticatedTutor:
    """Comprobación 1 del ADR 0001: JWT válido; `tutor_id` es el `sub` del token.

    Responde siempre 401 genérico: no se explica qué falló.
    """
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        log_event(logger, "auth.rejected", code="missing_token")
        raise ApiError(401, "unauthorized")

    verifier: TokenVerifier = request.app.state.token_verifier
    try:
        # La verificación puede consultar el JWKS (E/S bloqueante): fuera del bucle de eventos.
        return await anyio.to_thread.run_sync(verifier.verify, token)
    except InvalidToken as exc:
        log_event(logger, "auth.rejected", code=exc.reason)
        raise ApiError(401, "unauthorized") from None


def _require_role(user: AuthenticatedTutor, role: str | None) -> AuthenticatedTutor:
    if user.app_role != role:
        log_event(logger, "auth.rejected", code="wrong_app_role")
        raise ApiError(403, "forbidden")
    return user


async def get_current_tutor(request: Request) -> AuthenticatedTutor:
    """Solo tutores: un token de docente o de administrador no entra a las rutas del tutor."""
    return _require_role(await _authenticate(request), None)


async def get_current_teacher(request: Request) -> AuthenticatedTutor:
    """Solo docentes (`app_metadata.role == "teacher"`) QUE SIGAN TENIENDO PERFIL.

    Un docente eliminado puede conservar un token vigente unos minutos; como su perfil ya no
    existe, se rechaza igual (403). `tutor_id` es aquí el id del docente.
    """
    user = _require_role(await _authenticate(request), "teacher")
    gateway: Gateway = request.app.state.gateway
    try:
        profile = await gateway.teacher_profile(user.tutor_id)
    except GatewayError as exc:
        log_event(logger, "auth.rejected", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if profile is None:
        log_event(logger, "auth.rejected", code="teacher_profile_missing")
        raise ApiError(403, "forbidden")
    request.state.teacher_profile = profile  # lo reutiliza la ruta, sin segunda consulta
    return user


async def get_current_admin(request: Request) -> AuthenticatedTutor:
    """Solo administradores (`app_metadata.role == "admin"`). `tutor_id` es aquí el id del admin."""
    return _require_role(await _authenticate(request), "admin")


# Uso en rutas: `async def ruta(tutor: CurrentTutor): ...`
CurrentTutor = Annotated[AuthenticatedTutor, Depends(get_current_tutor)]
CurrentTeacher = Annotated[AuthenticatedTutor, Depends(get_current_teacher)]
CurrentAdmin = Annotated[AuthenticatedTutor, Depends(get_current_admin)]


async def get_authorized_student(
    student_id: uuid.UUID, tutor: CurrentTutor, request: Request
) -> AuthorizedStudent:
    """Comprobaciones 1 a 3 del ADR 0001 para rutas con `{student_id}` en la ruta."""
    gateway: Gateway = request.app.state.gateway
    return await authorize_student(gateway, tutor, student_id)


# Uso en rutas: `async def ruta(student: AuthorizedStudentDep): ...`
AuthorizedStudentDep = Annotated[AuthorizedStudent, Depends(get_authorized_student)]


def parental_key(request: Request) -> bytes:
    """Clave base del token parental. Falla cerrado si no hay clave configurada."""
    key = request.app.state.settings.exercise_signing_key.get_secret_value()
    if not key:
        log_event(logger, "parental.denied", code="signing_key_missing")
        raise ApiError(503, "service_unavailable")
    return key.encode()


# Vincular o quitar a un docente exige un PIN escrito hace muy poco: no basta el permiso del panel.
FRESH_PIN_SECONDS = 120


def _require_parental(
    request: Request, tutor: AuthenticatedTutor, max_age: float | None = None
) -> None:
    try:
        verify_parental_token(
            parental_key(request),
            request.headers.get("x-parental-token"),
            tutor.tutor_id,
            max_age=max_age,
        )
    except InvalidParentalToken:
        log_event(logger, "parental.denied", code="token_invalid")
        raise ApiError(
            401, "parental_required", message="Escribe tu PIN para entrar al panel."
        ) from None


async def get_parental_student(
    student_id: uuid.UUID, tutor: CurrentTutor, request: Request
) -> AuthorizedStudent:
    """Como `get_authorized_student`, pero además exige el token parental (PIN verificado)."""
    _require_parental(request, tutor)
    return await get_authorized_student(student_id, tutor, request)


# Rutas de la zona del tutor (panel): `async def ruta(student: ParentalStudentDep): ...`
ParentalStudentDep = Annotated[AuthorizedStudent, Depends(get_parental_student)]


async def get_parental_tutor(tutor: CurrentTutor, request: Request) -> AuthenticatedTutor:
    """Tutor con PIN verificado, sin exigir consentimiento vigente ni perfil desbloqueado.

    Para borrar perfiles: es un derecho del titular y debe funcionar siempre.
    """
    _require_parental(request, tutor)
    return tutor


ParentalTutorDep = Annotated[AuthenticatedTutor, Depends(get_parental_tutor)]


async def get_fresh_parental_student(
    student_id: uuid.UUID, tutor: CurrentTutor, request: Request
) -> AuthorizedStudent:
    """Como `get_parental_student`, pero el PIN debe haberse verificado hace menos de 2 minutos."""
    _require_parental(request, tutor, max_age=FRESH_PIN_SECONDS)
    return await get_authorized_student(student_id, tutor, request)


FreshParentalStudentDep = Annotated[AuthorizedStudent, Depends(get_fresh_parental_student)]


async def get_fresh_parental_tutor(tutor: CurrentTutor, request: Request) -> AuthenticatedTutor:
    """Tutor con el PIN recién verificado, sin exigir consentimiento vigente ni perfil desbloqueado
    (quitar un vínculo debe poder hacerse siempre)."""
    _require_parental(request, tutor, max_age=FRESH_PIN_SECONDS)
    return tutor


FreshParentalTutorDep = Annotated[AuthenticatedTutor, Depends(get_fresh_parental_tutor)]
