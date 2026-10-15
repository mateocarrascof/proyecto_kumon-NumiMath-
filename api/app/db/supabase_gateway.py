"""Gateway sobre la API REST de Supabase (PostgREST), con la llave de servidor.

Cada llamada RPC es UNA transacción en READ COMMITTED (el valor por defecto de PostgreSQL
que PostgREST no cambia) y la base además rechaza otro nivel (migración api_support).

La llave de servidor ignora RLS: por eso todo acceso pasa por funciones de la base que
validan la propiedad del perfil (ADR 0001). Nunca se registra la URL, el cuerpo ni la llave.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from app.config import Settings
from app.db.gateway import GatewayError

_TIMEOUT = httpx.Timeout(5.0, connect=2.0)


class SupabaseGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._key = settings.supabase_service_role_key.get_secret_value()
        self._base_url = settings.supabase_url.rstrip("/") + "/rest/v1"
        # El cliente HTTP se crea al primer uso: construirlo carga certificados (~0,3 s).
        self._client = client

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers={
                    "apikey": self._key,
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type": "application/json",
                },
                timeout=_TIMEOUT,
            )
        return self._client

    async def _rpc(self, name: str, payload: dict[str, Any]) -> Any:
        if not self._key:
            raise GatewayError("not_configured")
        try:
            response = await self._get_client().post(f"/rpc/{name}", json=payload)
        except httpx.HTTPError:
            # El texto de la excepción puede incluir la URL: no se conserva.
            raise GatewayError("transport") from None
        if response.status_code not in (200, 204):
            raise GatewayError(f"status_{response.status_code}")
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            raise GatewayError("bad_json") from None

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        result = await self._rpc(
            "authorize_student_use",
            {"p_tutor_id": str(tutor_id), "p_student_id": str(student_id)},
        )
        if not isinstance(result, str):
            raise GatewayError("unexpected_result")
        return result

    async def consume_usage(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        cost: int,
        student_limit: int,
        tutor_limit: int,
    ) -> str:
        result = await self._rpc(
            "consume_usage",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_cost": cost,
                "p_student_limit": student_limit,
                "p_tutor_limit": tutor_limit,
            },
        )
        if result not in ("ok", "student_limit", "tutor_limit"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def assert_read_committed(self) -> None:
        await self._rpc("assert_read_committed", {})

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
