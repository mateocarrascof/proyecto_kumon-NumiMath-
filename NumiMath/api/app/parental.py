"""PIN del tutor (control parental) y token parental de corta vida.

- El PIN (4 dígitos) se guarda solo como hash argon2id en `tutor_pins`; nunca en claro ni en logs.
- Verificarlo da un token parental: HMAC-SHA256 sobre (tutor, vencimiento), ligado al tutor del JWT,
  que la app manda en `X-Parental-Token` para las rutas del panel. Vida: 10 minutos.
- La clave del token se deriva de la de ejercicios con separación de dominio: no hace falta otra
  variable de entorno, y un token de ejercicio nunca sirve como token parental (ni al revés).
Reglas: docs/SPEC.md ("PIN del tutor").
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Final

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

PIN_LENGTH: Final = 4
TOKEN_TTL_SECONDS: Final = 600
# "Olvidé mi PIN": el login con contraseña debe ser así de reciente.
REAUTH_MAX_AGE_SECONDS: Final = 300

_HASHER = PasswordHasher()  # argon2id con los parámetros por defecto de la librería


class InvalidParentalToken(Exception):
    """Token parental ausente, alterado, vencido o de otro tutor. No se explica cuál."""


def pin_problem(pin: str) -> str | None:
    """`None` si el PIN sirve; si no, `format` (no son 4 dígitos) o `weak` (fácil de adivinar)."""
    if len(pin) != PIN_LENGTH or not pin.isascii() or not pin.isdigit():
        return "format"
    digits = [int(c) for c in pin]
    steps = {b - a for a, b in zip(digits, digits[1:], strict=False)}
    if len(set(digits)) == 1 or steps in ({1}, {-1}):
        return "weak"
    return None


def hash_pin(pin: str) -> str:
    return _HASHER.hash(pin)


def verify_pin(pin_hash: str, pin: str) -> bool:
    try:
        return _HASHER.verify(pin_hash, pin)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _key(signing_key: bytes) -> bytes:
    return hmac.new(signing_key, b"parental-token-key", hashlib.sha256).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_parental_token(signing_key: bytes, tutor_id: uuid.UUID, now: float | None = None) -> str:
    expires_at = int((time.time() if now is None else now) + TOKEN_TTL_SECONDS)
    payload = json.dumps({"t": str(tutor_id), "e": expires_at}, separators=(",", ":")).encode()
    signature = hmac.new(_key(signing_key), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(signature)}"


def verify_parental_token(
    signing_key: bytes,
    token: str | None,
    tutor_id: uuid.UUID,
    now: float | None = None,
    max_age: float | None = None,
) -> None:
    """Valida el token. Con `max_age`, además exige que el PIN se haya verificado hace poco
    (el token vence a los `TOKEN_TTL_SECONDS`; su edad es `TTL - tiempo que le queda`)."""
    if not token or len(token) > 300:
        raise InvalidParentalToken
    try:
        payload_b64, signature_b64 = token.split(".")
        payload, signature = _unb64(payload_b64), _unb64(signature_b64)
    except (ValueError, TypeError):
        raise InvalidParentalToken from None
    expected = hmac.new(_key(signing_key), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        raise InvalidParentalToken
    try:
        data = json.loads(payload)
        owner = uuid.UUID(str(data["t"]))
        expires_at = int(data["e"])
    except (ValueError, KeyError, TypeError):
        raise InvalidParentalToken from None
    moment = time.time() if now is None else now
    if owner != tutor_id or moment >= expires_at:
        raise InvalidParentalToken
    if max_age is not None and moment - (expires_at - TOKEN_TTL_SECONDS) > max_age:
        raise InvalidParentalToken


def recently_reauthenticated(password_auth_at: int | None, now: float | None = None) -> bool:
    if password_auth_at is None:
        return False
    age = (time.time() if now is None else now) - password_auth_at
    return -60 <= age <= REAUTH_MAX_AGE_SECONDS
