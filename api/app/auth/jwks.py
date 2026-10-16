"""Cliente JWKS para validar tokens firmados con clave pública (ES256, RS256, EdDSA).

Reglas:
- Caché corta (`ttl`): las claves vencidas se vuelven a pedir; si no se puede, se FALLA CERRADO
  (no se siguen usando claves viejas).
- Un `kid` desconocido provoca una recarga, pero como máximo una cada `cooldown` segundos: un
  atacante que envíe `kid` al azar no puede convertir la API en un martillo contra el JWKS.
- Solo se aceptan claves de firma asimétricas (EC, RSA, OKP). Una clave simétrica (`oct`)
  publicada en el JWKS se ignora: jamás puede servir para validar un token.
- Cualquier fallo (red, HTTP, JSON, clave inválida) lanza `PyJWKClientError`, que el verificador
  traduce en "no autorizado".
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

import httpx
import jwt
from jwt import PyJWK
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

_ASYMMETRIC_KTY = frozenset({"EC", "RSA", "OKP"})
_FETCH_TIMEOUT = httpx.Timeout(3.0, connect=1.5)


class CachedJwksClient:
    def __init__(
        self,
        url: str,
        *,
        ttl: float = 60.0,
        cooldown: float = 10.0,
        clock: Callable[[], float] = time.monotonic,
        http: httpx.Client | None = None,
    ) -> None:
        self._url = url
        self._ttl = ttl
        self._cooldown = cooldown
        self._clock = clock
        self._http = http
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._lock = threading.Lock()

    def _fetch(self) -> dict[str, PyJWK]:
        try:
            client = self._http or httpx.Client(timeout=_FETCH_TIMEOUT)
            try:
                response = client.get(self._url)
            finally:
                if self._http is None:
                    client.close()
        except httpx.HTTPError:
            # El texto de la excepción puede incluir la URL: no se conserva.
            raise PyJWKClientConnectionError("jwks_unreachable") from None
        if response.status_code != 200:
            raise PyJWKClientConnectionError("jwks_bad_status")
        try:
            document: Any = response.json()
            raw_keys = document["keys"]
            if not isinstance(raw_keys, list):
                raise TypeError
        except (ValueError, KeyError, TypeError):
            raise PyJWKClientError("jwks_bad_document") from None

        keys: dict[str, PyJWK] = {}
        for raw in raw_keys:
            if not isinstance(raw, dict) or raw.get("kty") not in _ASYMMETRIC_KTY:
                continue
            if raw.get("use", "sig") != "sig" or not isinstance(raw.get("kid"), str):
                continue
            try:
                keys[raw["kid"]] = PyJWK.from_dict(raw)
            except jwt.PyJWTError:
                continue
        if not keys:
            raise PyJWKClientError("jwks_empty")
        return keys

    def _refresh(self) -> None:
        self._keys = self._fetch()
        self._fetched_at = self._clock()

    def get_signing_key_from_jwt(self, token: str) -> PyJWK:
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError:
            raise PyJWKClientError("malformed") from None
        if not isinstance(kid, str) or not kid:
            raise PyJWKClientError("missing_kid")

        with self._lock:
            now = self._clock()
            expired = self._fetched_at is None or now - self._fetched_at >= self._ttl
            if expired:
                # Caché vencida: se recarga o se falla cerrado (sin claves "de respaldo").
                self._keys = {}
                self._refresh()
            elif kid not in self._keys and now - (self._fetched_at or 0.0) >= self._cooldown:
                self._refresh()
            key = self._keys.get(kid)
        if key is None:
            raise PyJWKClientError("unknown_kid")
        return key
