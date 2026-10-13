"""Comprobaciones 2 y 3 del ADR 0001: perfil del tutor, no bloqueado y con consentimiento.

Falla cerrado. Un error de infraestructura deniega (503: no se pudo verificar, reintentar);
cualquier respuesta inesperada de la base también deniega.

Los códigos internos (`student_not_found`, `student_blocked`) NO se distinguen hacia el cliente:
ambos son el mismo 403 genérico, para no revelar si un perfil ajeno existe o está bloqueado.
Solo `consent_required` tiene su propio código, porque es lo que la app debe resolver.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.auth.jwt import AuthenticatedTutor
from app.db.gateway import Gateway, GatewayError
from app.errors import ApiError
from app.logging import get_logger, log_event

logger = get_logger("mathtutor.access")


@dataclass(frozen=True)
class AuthorizedStudent:
    tutor_id: uuid.UUID
    student_id: uuid.UUID


async def authorize_student(
    gateway: Gateway, tutor: AuthenticatedTutor, student_id: uuid.UUID
) -> AuthorizedStudent:
    try:
        # El tutor sale SIEMPRE del JWT, nunca de la ruta ni del cuerpo de la petición.
        code = await gateway.authorize_student_use(tutor.tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "access.denied", stage="authorize", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None

    if code == "ok":
        return AuthorizedStudent(tutor_id=tutor.tutor_id, student_id=student_id)
    if code == "consent_required":
        log_event(logger, "access.denied", stage="authorize", code=code)
        raise ApiError(403, "consent_required")
    if code in ("student_not_found", "student_blocked"):
        log_event(logger, "access.denied", stage="authorize", code=code)
        raise ApiError(403, "forbidden")

    # Respuesta desconocida: se trata como no autorizado.
    log_event(logger, "access.denied", stage="authorize", code="unexpected_code")
    raise ApiError(403, "forbidden")
