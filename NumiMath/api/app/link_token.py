"""Token de confirmación del vínculo con un docente (T25).

Se entrega después de buscar al docente por su código (con el PIN recién verificado y contando
intentos) y liga TRES cosas: el tutor, el hijo y el docente que se le mostró (con su nombre y la
versión del texto legal). Para crear el vínculo hay que devolverlo: así el código no se reenvía ni
cuesta otro intento, y el tutor solo puede confirmar a quien vio. Dura pocos minutos.

Firmado con HMAC-SHA256 con una clave derivada de la de firma del servidor (separación de dominio).
Nunca se registra.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass
from typing import Final

LINK_TOKEN_TTL_SECONDS: Final = 480  # menos que la vigencia del permiso del PIN (600 s)
_DOMAIN: Final = b"numimath.teacher-link.v1:"


class InvalidLinkToken(Exception):
    pass


@dataclass(frozen=True)
class LinkClaims:
    tutor_id: uuid.UUID
    student_id: uuid.UUID
    teacher_id: uuid.UUID
    teacher_name: str
    terms_id: uuid.UUID


def _key(signing_key: bytes) -> bytes:
    return hashlib.sha256(_DOMAIN + signing_key).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_link_token(signing_key: bytes, claims: LinkClaims, now: float | None = None) -> str:
    expires_at = int((time.time() if now is None else now) + LINK_TOKEN_TTL_SECONDS)
    payload = json.dumps(
        {
            "t": str(claims.tutor_id),
            "s": str(claims.student_id),
            "d": str(claims.teacher_id),
            "n": claims.teacher_name,
            "v": str(claims.terms_id),
            "e": expires_at,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    signature = hmac.new(_key(signing_key), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(signature)}"


def verify_link_token(
    signing_key: bytes,
    token: str | None,
    tutor_id: uuid.UUID,
    student_id: uuid.UUID,
    now: float | None = None,
) -> LinkClaims:
    """Devuelve lo firmado si el token es auténtico, vigente y de este tutor y este hijo."""
    if not token or len(token) > 900:
        raise InvalidLinkToken
    try:
        payload_b64, signature_b64 = token.split(".")
        payload, signature = _unb64(payload_b64), _unb64(signature_b64)
    except (ValueError, TypeError):
        raise InvalidLinkToken from None
    expected = hmac.new(_key(signing_key), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        raise InvalidLinkToken
    try:
        data = json.loads(payload)
        claims = LinkClaims(
            tutor_id=uuid.UUID(str(data["t"])),
            student_id=uuid.UUID(str(data["s"])),
            teacher_id=uuid.UUID(str(data["d"])),
            teacher_name=str(data["n"]),
            terms_id=uuid.UUID(str(data["v"])),
        )
        expires_at = int(data["e"])
    except (ValueError, KeyError, TypeError):
        raise InvalidLinkToken from None
    if (time.time() if now is None else now) >= expires_at:
        raise InvalidLinkToken
    if claims.tutor_id != tutor_id or claims.student_id != student_id:
        raise InvalidLinkToken
    return claims
