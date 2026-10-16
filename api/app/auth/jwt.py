"""Validación del JWT de Supabase (ADR 0001, comprobación 1).

Reglas:
- Solo se aceptan tokens de un TUTOR autenticado: `role == "authenticated"`, con `aud` e `iss`
  esperados, `exp` y `sub` presentes, y NO anónimos. Los tokens `anon` y `service_role`
  se rechazan aunque tengan firma válida.
- El algoritmo se elige por token y está restringido: HS256 solo con el secreto configurado;
  ES256/RS256/EdDSA solo con las claves del JWKS. Nunca se acepta `none` ni se usa una clave
  pública como secreto HMAC (confusión de algoritmos).
- Cualquier fallo es "no autorizado". El motivo se registra como código (sin el token) y NO
  se devuelve al cliente.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

import jwt

from app.auth.jwks import CachedJwksClient
from app.config import Settings

_ASYMMETRIC_ALGS = frozenset({"ES256", "RS256", "EdDSA"})
_REQUIRED_CLAIMS = ["exp", "sub", "aud", "iss"]


class InvalidToken(Exception):
    """El token no es válido. `reason` es un código estable, apto para logs."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class AuthenticatedTutor:
    tutor_id: uuid.UUID


class SigningKey(Protocol):
    key: Any


class JwksClient(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> SigningKey: ...


class TokenVerifier:
    def __init__(self, settings: Settings, jwks_client: JwksClient | None = None) -> None:
        self._secret = settings.supabase_jwt_secret.get_secret_value()
        self._audience = settings.jwt_audience
        self._issuer = settings.expected_issuer
        self._leeway = 10  # segundos de tolerancia por diferencia de reloj
        # JWKS: la URL configurada o, por defecto, la del propio Supabase (`<SUPABASE_URL>/auth/v1/
        # .well-known/jwks.json`), que es de donde sale el `iss` esperado. No se pide nada a la red
        # hasta que llegue el primer token con algoritmo asimétrico.
        self._jwks: JwksClient = jwks_client or CachedJwksClient(settings.expected_jwks_url)

    def verify(self, token: str) -> AuthenticatedTutor:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise InvalidToken("malformed") from exc

        alg = header.get("alg")
        key: Any
        if alg == "HS256":
            if not self._secret:
                raise InvalidToken("alg_not_allowed")
            key = self._secret
        elif alg in _ASYMMETRIC_ALGS:
            try:
                signing_key = self._jwks.get_signing_key_from_jwt(token)
            except jwt.PyJWTError as exc:
                raise InvalidToken("unknown_key") from exc
            # Si el JWKS declara el algoritmo de la clave, el token debe usar exactamente ese.
            declared = getattr(signing_key, "algorithm_name", None)
            if declared is not None and declared != alg:
                raise InvalidToken("alg_not_allowed")
            key = signing_key.key
        else:
            raise InvalidToken("alg_not_allowed")

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=self._audience,
                issuer=self._issuer,
                leeway=self._leeway,
                options={"require": _REQUIRED_CLAIMS},
            )
        except jwt.ExpiredSignatureError as exc:
            raise InvalidToken("expired") from exc
        except jwt.InvalidAudienceError as exc:
            raise InvalidToken("wrong_audience") from exc
        except jwt.InvalidIssuerError as exc:
            raise InvalidToken("wrong_issuer") from exc
        except jwt.InvalidSignatureError as exc:
            raise InvalidToken("bad_signature") from exc
        except jwt.PyJWTError as exc:
            raise InvalidToken("invalid") from exc

        if claims.get("role") != "authenticated":
            raise InvalidToken("wrong_role")
        if claims.get("is_anonymous") is True:
            raise InvalidToken("anonymous")
        try:
            tutor_id = uuid.UUID(str(claims["sub"]))
        except ValueError as exc:
            raise InvalidToken("bad_subject") from exc
        return AuthenticatedTutor(tutor_id=tutor_id)
