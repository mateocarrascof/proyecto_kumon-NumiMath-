"""Zona del tutor: vincular un docente a UN hijo (T25, con el aviso de T24) y quitarlo (T26).

- **Buscar** (`POST …/teacher-links/lookup`): con el PIN recién verificado (menos de 2 minutos, no
  basta el permiso del panel) y el código de 8 caracteres. Devuelve solo el NOMBRE del docente y el
  texto legal vigente que el tutor debe aceptar, más un token de confirmación firmado. Un código que
  no existe responde siempre lo mismo (404); tras 5 fallos seguidos el tutor queda 15 minutos
  bloqueado (429). El docente no se entera de nada y el código nunca se registra.
- **Crear** (`POST …/teacher-links`): con el token de confirmación y `accept: true` (el tutor acepta
  el texto). Guarda `accepted_at`, la versión aceptada y el nombre mostrado. Exige consentimiento
  vigente.
- **Listar** (`GET …/teachers`) y **quitar** (`DELETE …/teachers/{id}`): quitar pide otra vez el PIN
  recién verificado, funciona aunque el perfil esté bloqueado y NO borra datos del niño ni sus
  hojas.
- Cada hijo se vincula por separado. Esta ruta no lee ningún dato de niños.
Reglas: docs/SPEC.md ("Docentes y administradores").
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.db.gateway import Gateway, GatewayError
from app.deps import (
    FreshParentalStudentDep,
    FreshParentalTutorDep,
    ParentalStudentDep,
    ParentalTutorDep,
    parental_key,
)
from app.errors import ApiError
from app.link_token import (
    InvalidLinkToken,
    LinkClaims,
    issue_link_token,
    verify_link_token,
)
from app.logging import get_logger, log_event

router = APIRouter(prefix="/v1/students", tags=["teacher-links"])
logger = get_logger("mathtutor.teacher_links")

_CODE = re.compile(r"^[A-Z2-9]{8}$")
_NOT_FOUND = "No encontramos un docente con ese código. Revisa el código e inténtalo de nuevo."
_EXPIRED = "La confirmación venció o cambió. Vuelve a ingresar el código del docente."


class LookupIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: Annotated[str, Field(max_length=40)]


class TermsOut(BaseModel):
    id: uuid.UUID
    version: str
    sha256: str


class LookupOut(BaseModel):
    teacher_name: str
    confirmation_token: str
    terms: TermsOut


class CreateIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    confirmation_token: Annotated[str, Field(max_length=900)]
    accept: bool


class LinkedTeacherOut(BaseModel):
    teacher_id: uuid.UUID
    name: str
    shown_name: str
    accepted_at: datetime


class TeachersOut(BaseModel):
    teachers: list[LinkedTeacherOut]


def _gateway(request: Request) -> Gateway:
    gateway: Gateway = request.app.state.gateway
    return gateway


@router.post("/{student_id}/teacher-links/lookup")
async def lookup_teacher(
    body: LookupIn, student: FreshParentalStudentDep, request: Request, response: Response
) -> LookupOut:
    response.headers["Cache-Control"] = "no-store"
    code = body.code.strip().upper()
    if not _CODE.match(code):
        # Mismo mensaje que un código inexistente. No cuenta como intento: no toca a ningún docente.
        raise ApiError(404, "code_not_found", message=_NOT_FOUND)
    try:
        found = await _gateway(request).teacher_link_lookup(
            student.tutor_id, student.student_id, code
        )
    except GatewayError as exc:
        log_event(logger, "teacher_link.lookup_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None

    if found.status == "locked":
        log_event(logger, "teacher_link.locked")
        raise ApiError(
            429,
            "rate_limited",
            message="Demasiados intentos con códigos que no existen. Espera 15 minutos.",
            headers={"Retry-After": str(max(1, found.retry_after))},
        )
    if found.status == "not_found":
        log_event(logger, "teacher_link.code_not_found")
        raise ApiError(404, "code_not_found", message=_NOT_FOUND)
    if found.status == "already_linked":
        raise ApiError(
            409, "already_linked", message="Ese docente ya está vinculado a este perfil."
        )
    if found.status == "student_not_found":
        raise ApiError(403, "forbidden")
    if (
        found.status != "ok" or found.teacher_id is None or found.terms_id is None
    ):  # no_terms u otro estado: no hay nada que aceptar
        log_event(logger, "teacher_link.lookup_failed", code=found.status)
        raise ApiError(503, "service_unavailable")

    token = issue_link_token(
        parental_key(request),
        LinkClaims(
            tutor_id=student.tutor_id,
            student_id=student.student_id,
            teacher_id=found.teacher_id,
            teacher_name=found.name,
            terms_id=found.terms_id,
        ),
    )
    return LookupOut(
        teacher_name=found.name,
        confirmation_token=token,
        terms=TermsOut(id=found.terms_id, version=found.terms_version, sha256=found.terms_sha256),
    )


@router.post("/{student_id}/teacher-links", status_code=201)
async def create_link(
    body: CreateIn, student: ParentalStudentDep, request: Request, response: Response
) -> LinkedTeacherOut:
    response.headers["Cache-Control"] = "no-store"
    if not body.accept:
        raise ApiError(
            422,
            "acceptance_required",
            message="Para vincular al docente debes aceptar el texto de autorización.",
        )
    try:
        claims = verify_link_token(
            parental_key(request),
            body.confirmation_token,
            student.tutor_id,
            student.student_id,
        )
    except InvalidLinkToken:
        log_event(logger, "teacher_link.denied", code="confirmation_invalid")
        raise ApiError(422, "confirmation_expired", message=_EXPIRED) from None

    try:
        result = await _gateway(request).create_teacher_link(
            student.tutor_id,
            student.student_id,
            claims.teacher_id,
            claims.teacher_name,
            claims.terms_id,
        )
    except GatewayError as exc:
        log_event(logger, "teacher_link.create_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None

    if result == "already_linked":
        raise ApiError(
            409, "already_linked", message="Ese docente ya está vinculado a este perfil."
        )
    if result in ("name_changed", "terms_outdated", "teacher_not_found"):
        log_event(logger, "teacher_link.denied", code=result)
        raise ApiError(409, "confirmation_expired", message=_EXPIRED)
    if result == "consent_required":
        raise ApiError(403, "consent_required")
    if result != "ok":
        raise ApiError(403, "forbidden")
    log_event(logger, "teacher_link.created")
    return LinkedTeacherOut(
        teacher_id=claims.teacher_id,
        name=claims.teacher_name,
        shown_name=claims.teacher_name,
        accepted_at=datetime.now().astimezone(),
    )


@router.get("/{student_id}/teachers")
async def list_teachers(
    student_id: uuid.UUID, tutor: ParentalTutorDep, request: Request, response: Response
) -> TeachersOut:
    response.headers["Cache-Control"] = "no-store"
    try:
        rows = await _gateway(request).list_student_teachers(tutor.tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "teacher_link.list_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if rows is None:
        raise ApiError(403, "forbidden")
    return TeachersOut(
        teachers=[
            LinkedTeacherOut(
                teacher_id=r.teacher_id,
                name=r.name,
                shown_name=r.shown_name,
                accepted_at=r.accepted_at,
            )
            for r in rows
        ]
    )


@router.delete("/{student_id}/teachers/{teacher_id}", status_code=204)
async def remove_link(
    student_id: uuid.UUID, teacher_id: uuid.UUID, tutor: FreshParentalTutorDep, request: Request
) -> Response:
    try:
        outcome = await _gateway(request).remove_teacher_link(
            tutor.tutor_id, student_id, teacher_id
        )
    except GatewayError as exc:
        log_event(logger, "teacher_link.remove_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome != "ok":
        raise ApiError(404, "not_found")
    log_event(logger, "teacher_link.removed")
    return Response(status_code=204)
