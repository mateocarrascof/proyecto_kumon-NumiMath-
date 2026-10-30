"""PIN del tutor: estado, verificación (da el token parental) y creación o cambio.

- El hash (argon2id) se calcula y compara aquí, fuera del bucle de eventos (es costoso a propósito).
- Intentos y bloqueo los lleva la base (`register_pin_attempt`: 5 fallos → 15 minutos).
- Crear o cambiar: sin PIN previo; con token parental vigente (cambiar); o con un login con
  contraseña de hace menos de 5 minutos ("Olvidé mi PIN").
- Nunca se registra el PIN: los logs llevan solo códigos.
Reglas: docs/SPEC.md ("PIN del tutor").
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.db.gateway import Gateway, GatewayError
from app.deps import CurrentTutor, parental_key
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.parental import (
    TOKEN_TTL_SECONDS,
    InvalidParentalToken,
    hash_pin,
    issue_parental_token,
    pin_problem,
    recently_reauthenticated,
    verify_parental_token,
    verify_pin,
)

router = APIRouter(prefix="/v1/tutor/pin", tags=["pin"])
logger = get_logger("mathtutor.pin")

MAX_FAILS = 5  # igual que register_pin_attempt en la base

_WEAK = "Ese PIN es fácil de adivinar. Evita 4 números iguales o seguidos (como 1234)."
_FORMAT = "El PIN debe tener 4 números."


class PinIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pin: Annotated[str, Field(min_length=1, max_length=12)]


class PinStatusOut(BaseModel):
    has_pin: bool
    locked_until: datetime | None = None


class TokenOut(BaseModel):
    token: str
    expires_in: int


def _gateway(request: Request) -> Gateway:
    return request.app.state.gateway


def _unavailable(stage: str, exc: GatewayError) -> ApiError:
    log_event(logger, "pin.denied", stage=stage, code=f"gateway_{exc.reason}")
    return ApiError(503, "service_unavailable")


def _locked(until: datetime) -> ApiError:
    return ApiError(
        423,
        "pin_locked",
        message="Demasiados intentos. Espera unos minutos e inténtalo otra vez.",
        extra={"locked_until": until.isoformat()},
    )


def _token(request: Request, tutor: CurrentTutor) -> TokenOut:
    token = issue_parental_token(parental_key(request), tutor.tutor_id)
    return TokenOut(token=token, expires_in=TOKEN_TTL_SECONDS)


@router.get("")
async def pin_status(tutor: CurrentTutor, request: Request) -> PinStatusOut:
    try:
        state = await _gateway(request).get_pin_state(tutor.tutor_id)
    except GatewayError as exc:
        raise _unavailable("status", exc) from None
    if state is None:
        return PinStatusOut(has_pin=False)
    locked = state.locked_until if state.locked_until and state.locked_until > _now() else None
    return PinStatusOut(has_pin=True, locked_until=locked)


@router.post("/verify")
async def verify(body: PinIn, tutor: CurrentTutor, request: Request) -> TokenOut:
    key = parental_key(request)  # falla cerrado antes de tocar la base
    gateway = _gateway(request)
    try:
        state = await gateway.get_pin_state(tutor.tutor_id)
    except GatewayError as exc:
        raise _unavailable("state", exc) from None
    if state is None:
        raise ApiError(404, "pin_not_set", message="Todavía no creas un PIN.")
    if state.locked_until is not None and state.locked_until > _now():
        raise _locked(state.locked_until)

    ok = pin_problem(body.pin) is None and await anyio.to_thread.run_sync(
        verify_pin, state.pin_hash, body.pin
    )
    try:
        locked_until, fails = await gateway.register_pin_attempt(tutor.tutor_id, ok)
    except GatewayError as exc:
        raise _unavailable("attempt", exc) from None
    if locked_until is not None and locked_until > _now():
        log_event(logger, "pin.locked")
        raise _locked(locked_until)
    if not ok:
        log_event(logger, "pin.wrong")
        raise ApiError(
            401,
            "pin_wrong",
            message="PIN incorrecto.",
            extra={"remaining": str(max(0, MAX_FAILS - fails))},
        )
    return TokenOut(token=issue_parental_token(key, tutor.tutor_id), expires_in=TOKEN_TTL_SECONDS)


@router.post("")
async def set_pin(body: PinIn, tutor: CurrentTutor, request: Request) -> TokenOut:
    key = parental_key(request)
    problem = pin_problem(body.pin)
    if problem is not None:
        raise ApiError(422, f"pin_{problem}", message=_WEAK if problem == "weak" else _FORMAT)
    gateway = _gateway(request)
    try:
        state = await gateway.get_pin_state(tutor.tutor_id)
    except GatewayError as exc:
        raise _unavailable("state", exc) from None

    if state is not None and not _may_replace(request, tutor, key):
        log_event(logger, "pin.denied", stage="replace", code="reauth_required")
        raise ApiError(
            403,
            "pin_reauth_required",
            message="Para crear un PIN nuevo escribe primero el PIN actual o tu contraseña.",
        )
    pin_hash = await anyio.to_thread.run_sync(hash_pin, body.pin)
    try:
        await gateway.set_pin(tutor.tutor_id, pin_hash)
    except GatewayError as exc:
        raise _unavailable("set", exc) from None
    log_event(logger, "pin.set", kind="create" if state is None else "replace")
    return _token(request, tutor)


def _may_replace(request: Request, tutor: CurrentTutor, key: bytes) -> bool:
    """Cambiar: token parental vigente. Olvidé mi PIN: login con contraseña reciente."""
    try:
        verify_parental_token(key, request.headers.get("x-parental-token"), tutor.tutor_id)
        return True
    except InvalidParentalToken:
        return recently_reauthenticated(tutor.password_auth_at)


def _now() -> datetime:
    return datetime.now(UTC)
