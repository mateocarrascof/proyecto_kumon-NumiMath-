"""Administración de usuarios en Supabase Auth (GoTrue), solo para el servidor.

Se usa para el borrado de cuenta (ADR 0001, decisión 3): congelar (bloquear el acceso), descongelar
si algo falla antes de borrar, y borrar el usuario. Usa la llave de servidor: nunca sale de aquí.

Los errores solo llevan un código ("transport", "status_500"…): nunca la URL, el cuerpo ni la llave.
"""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.config import Settings

_TIMEOUT = httpx.Timeout(8.0, connect=2.0)
# Bloqueo CORTO mientras se borra: si algo falla y el desbloqueo también, se levanta solo y la
# familia no queda sin acceso. El borrado completo dura segundos.
_BAN_WHILE_DELETING = "15m"


class AuthAdminError(Exception):
    """Fallo de infraestructura al hablar con Auth. El llamador FALLA CERRADO."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class AuthAdmin(Protocol):
    async def get_email(self, user_id: uuid.UUID) -> str | None:
        """Correo del usuario, o `None` si el usuario no existe."""
        ...

    async def create_user(self, email: str, password: str, role: str) -> uuid.UUID:
        """Crea un usuario ya confirmado con `app_metadata.role`. Falla con `email_exists` si el
        correo ya tiene cuenta (no se crea nada)."""
        ...

    async def ban(self, user_id: uuid.UUID) -> None:
        """Bloquea el acceso del usuario por poco tiempo (congelar la cuenta mientras se borra)."""
        ...

    async def unban(self, user_id: uuid.UUID) -> None:
        """Deshace el bloqueo (descongelar si el borrado se aborta)."""
        ...

    async def delete(self, user_id: uuid.UUID) -> str:
        """Borra el usuario (borrado real, no lógico). `deleted` o `not_found`."""
        ...

    async def aclose(self) -> None: ...


class GoTrueAdmin:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._key = settings.supabase_service_role_key.get_secret_value()
        self._base_url = settings.supabase_url.rstrip("/") + "/auth/v1/admin"
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

    async def _call(self, method: str, user_id: uuid.UUID, **kwargs: Any) -> httpx.Response:
        if not self._key:
            raise AuthAdminError("not_configured")
        try:
            return await self._get_client().request(method, f"/users/{user_id}", **kwargs)
        except httpx.HTTPError:
            # El texto de la excepción puede incluir la URL: no se conserva.
            raise AuthAdminError("transport") from None

    async def get_email(self, user_id: uuid.UUID) -> str | None:
        response = await self._call("GET", user_id)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise AuthAdminError(f"status_{response.status_code}")
        try:
            email = response.json().get("email")
        except (ValueError, AttributeError):
            raise AuthAdminError("bad_json") from None
        return email if isinstance(email, str) and email else None

    async def create_user(self, email: str, password: str, role: str) -> uuid.UUID:
        if not self._key:
            raise AuthAdminError("not_configured")
        try:
            response = await self._get_client().post(
                "/users",
                json={
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "app_metadata": {"role": role},
                },
            )
        except httpx.HTTPError:
            raise AuthAdminError("transport") from None
        if response.status_code in (400, 409, 422):
            try:
                error_code = response.json().get("error_code")
            except (ValueError, AttributeError):
                error_code = None
            if error_code in ("email_exists", "user_already_exists"):
                raise AuthAdminError("email_exists")
        if response.status_code not in (200, 201):
            raise AuthAdminError(f"status_{response.status_code}")
        try:
            return uuid.UUID(str(response.json()["id"]))
        except (ValueError, KeyError, TypeError, AttributeError):
            raise AuthAdminError("bad_json") from None

    async def _set_ban(self, user_id: uuid.UUID, duration: str) -> None:
        response = await self._call("PUT", user_id, json={"ban_duration": duration})
        if response.status_code != 200:
            raise AuthAdminError(f"status_{response.status_code}")

    async def ban(self, user_id: uuid.UUID) -> None:
        await self._set_ban(user_id, _BAN_WHILE_DELETING)

    async def unban(self, user_id: uuid.UUID) -> None:
        await self._set_ban(user_id, "none")

    async def delete(self, user_id: uuid.UUID) -> str:
        # `should_soft_delete` falso: se borra de verdad (la supresión no admite "ocultar").
        response = await self._call("DELETE", user_id, json={"should_soft_delete": False})
        if response.status_code == 404:
            return "not_found"
        if response.status_code != 200:
            raise AuthAdminError(f"status_{response.status_code}")
        return "deleted"

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
