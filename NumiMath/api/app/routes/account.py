"""Zona del tutor: eliminar la cuenta y todos sus datos (T21).

Confirmación fuerte: (a) el PIN verificado (token parental) o una contraseña de hace menos de 5
minutos, Y (b) escribir la palabra ELIMINAR. Sin consentimiento vigente también se puede borrar:
suprimir los datos es un derecho del titular. El orden del borrado está en `app/account.py`.
Reglas: docs/SPEC.md ("Eliminar la cuenta").
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.account import AccountDeletionError, delete_account, evidence_key
from app.auth.admin import AuthAdmin
from app.db.gateway import Gateway
from app.deps import CurrentTutor, parental_key
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.parental import InvalidParentalToken, recently_reauthenticated, verify_parental_token

router = APIRouter(prefix="/v1/tutor/account", tags=["account"])
logger = get_logger("mathtutor.account")

CONFIRM_WORD = "ELIMINAR"
# El token del PIN debe ser reciente: no basta con haber entrado al panel hace minutos.
FRESH_PIN_SECONDS = 60


class DeleteAccountIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    confirm: Annotated[str, Field(max_length=40)]


def _confirm_identity(request: Request, tutor: CurrentTutor) -> None:
    """PIN escrito AHORA (token parental de menos de 60 s) o contraseña de hace menos de 5 min."""
    try:
        verify_parental_token(
            parental_key(request),
            request.headers.get("x-parental-token"),
            tutor.tutor_id,
            max_age_seconds=FRESH_PIN_SECONDS,
        )
        return
    except InvalidParentalToken:
        pass
    if recently_reauthenticated(tutor.password_auth_at):
        return
    log_event(logger, "account.denied", code="reauth_required")
    raise ApiError(
        401,
        "parental_required",
        message="Para eliminar la cuenta escribe tu PIN o vuelve a entrar con tu contraseña.",
    )


@router.post("/delete", status_code=204)
async def delete_my_account(
    body: DeleteAccountIn, tutor: CurrentTutor, request: Request
) -> Response:
    _confirm_identity(request, tutor)
    if body.confirm.strip() != CONFIRM_WORD:
        raise ApiError(
            422,
            "confirmation_required",
            message=f"Escribe {CONFIRM_WORD} para confirmar.",
        )

    state = request.app.state
    gateway: Gateway = state.gateway
    admin: AuthAdmin = state.auth_admin
    key = evidence_key(state.settings)
    if key is None:
        # Falla cerrado: sin la clave de las huellas no se puede archivar la evidencia ni borrar.
        log_event(logger, "account.denied", code="hmac_key_missing")
        raise ApiError(503, "service_unavailable")

    log_event(logger, "account.delete_started")
    try:
        await delete_account(gateway=gateway, admin=admin, tutor=tutor, key=key)
    except AccountDeletionError as exc:
        log_event(logger, "account.delete_failed", stage=exc.stage, code=exc.code)
        # Antes de borrar no se tocó nada; si el fallo fue tardío, la cuenta puede estar a medias
        # (y el consentimiento ya revocado): se dice la verdad y se pide reintentar.
        late = exc.stage in {"delete", "verify"}
        raise ApiError(
            503,
            "service_unavailable",
            message=(
                "No pudimos terminar de eliminar la cuenta. Vuelve a intentarlo: tus datos "
                "siguen protegidos."
                if late
                else "No pudimos eliminar la cuenta. Tus datos no se borraron, pero tus "
                "perfiles pueden haber quedado bloqueados. Vuelve a intentarlo."
            ),
        ) from None
    return Response(status_code=204)
