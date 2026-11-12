"""Zona del tutor: revocar el consentimiento (T20).

Revocar registra un evento con fecha-hora del servidor (la constancia) y bloquea todos los
perfiles del tutor en la misma transacción (triggers de la base): desde ese momento no hay
práctica, tareas, informes ni IA para esos perfiles (`authorize_student_use` los rechaza).
Los datos NO se borran al instante: quedan bloqueados `purge_after_days` días (plazo
provisional, pendiente legal) y luego los borra pg_cron. Antes de ese plazo el tutor puede
borrarlos él mismo (perfiles o cuenta). Pide el PIN (zona del tutor).
Reglas: docs/SPEC.md ("Revocar el consentimiento").
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.db.gateway import Gateway, GatewayError
from app.deps import ParentalTutorDep
from app.errors import ApiError
from app.logging import get_logger, log_event

router = APIRouter(prefix="/v1/tutor/consent", tags=["consent"])
logger = get_logger("mathtutor.consent")

_NOT_CONFIRMED = (
    "No pudimos confirmar la revocación. Puede que ya esté hecha: vuelve a entrar para "
    "comprobarlo o inténtalo de nuevo."
)


class RevokeOut(BaseModel):
    status: Literal["revoked", "already_revoked"]
    revoked_at: datetime  # la constancia: fecha-hora UTC de la revocación
    profiles_blocked: int
    purge_after_days: int | None
    purge_at: datetime | None


@router.post("/revoke")
async def revoke_consent(tutor: ParentalTutorDep, request: Request) -> RevokeOut:
    gateway: Gateway = request.app.state.gateway
    try:
        result = await gateway.revoke_consent(tutor.tutor_id)
        if result == "no_consent":
            raise ApiError(
                409,
                "no_consent",
                message="Todavía no habías aceptado los términos: no hay nada que revocar.",
            )
        summary = await gateway.consent_summary(tutor.tutor_id)
    except GatewayError as exc:
        log_event(logger, "consent.revoke_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable", message=_NOT_CONFIRMED) from None

    # Se comprueba el resultado en vez de suponerlo: debe quedar la revocación con fecha y
    # ningún perfil activo. Si no, no se afirma nada.
    if (
        summary.last_event != "revoke"
        or summary.occurred_at is None
        or summary.profiles_active != 0
    ):
        log_event(logger, "consent.revoke_failed", code="not_effective")
        raise ApiError(503, "service_unavailable", message=_NOT_CONFIRMED)

    log_event(logger, "consent.revoked", outcome=result)
    return RevokeOut(
        status="revoked" if result == "ok" else "already_revoked",
        revoked_at=summary.occurred_at,
        profiles_blocked=summary.profiles_total,
        purge_after_days=summary.purge_after_days,
        purge_at=summary.purge_at,
    )
