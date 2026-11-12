"""Ciclo de vida de un docente contra el Supabase LOCAL (Auth y base reales): D2, D3, AD4 y AD5.

No corren por defecto. Con `supabase start` y las variables definidas (salen de
`supabase status -o env`; las llaves son las de DEMO local, nunca se versionan):

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> \\
        SUPABASE_SERVICE_ROLE_KEY=<servicio> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k teacher_lifecycle

Comprueba lo que los dobles no pueden:
- el docente entra con la contraseña inicial y ve su código (`/v1/teacher/me`);
- editar el correo rige AL INSTANTE (sin correo de confirmación): después el docente entra con el
  correo nuevo y NO con el viejo, y su token de refresco anterior deja de servir; el nombre cambia,
  el código no; queda el registro (solo ids);
- un correo de otra cuenta responde 409 y no cambia nada;
- eliminar borra la cuenta: ya no puede entrar y su token, aún vigente, recibe 403 en `/me`.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_PASSWORD = "Clave-inicial-123"


@pytest.fixture
def base() -> str:
    if not (_URL and _ANON and _SERVICE):
        pytest.skip("faltan SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY")
    return _URL.rstrip("/")


def _service(base: str, prefix: str) -> httpx.Client:
    return httpx.Client(
        base_url=f"{base}{prefix}",
        headers={"apikey": _SERVICE, "Authorization": f"Bearer {_SERVICE}"},
        timeout=20,
    )


def _login(base: str, email: str, password: str) -> httpx.Response:
    return httpx.post(
        f"{base}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": _ANON},
        json={"email": email, "password": password},
        timeout=20,
    )


def _token(base: str, email: str) -> str:
    response = _login(base, email, _PASSWORD)
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_ciclo_de_vida_del_docente_contra_el_auth_real(base: str) -> None:
    run = uuid.uuid4().hex[:10]
    admin_email = f"admin-{run}@example.test"
    old_email = f"docente-{run}@example.test"
    new_email = f"docente-nuevo-{run}@example.test"
    other_email = f"otro-{run}@example.test"
    auth = _service(base, "/auth/v1/admin")
    rest = _service(base, "/rest/v1")
    created = auth.post(
        "/users",
        json={
            "email": admin_email,
            "password": _PASSWORD,
            "email_confirm": True,
            "app_metadata": {"role": "admin"},
        },
    )
    assert created.status_code in (200, 201)
    admin_id = created.json()["id"]
    ids = [admin_id]
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=base,
        supabase_service_role_key=_SERVICE,
        exercise_signing_key="clave-de-firma-solo-pruebas-0123456789-abc",
    )
    try:
        # Con `with`, el cliente HTTP de la API vive en un solo bucle de eventos entre llamadas.
        with TestClient(create_app(settings), raise_server_exceptions=False) as api:
            admin = _bearer(_token(base, admin_email))
            first = api.post(
                "/v1/admin/teachers",
                json={"name": "Profe Inicial", "email": old_email, "password": _PASSWORD},
                headers=admin,
            )
            second = api.post(
                "/v1/admin/teachers",
                json={"name": "Otra Profe", "email": other_email, "password": _PASSWORD},
                headers=admin,
            )
            assert first.status_code == 201 and second.status_code == 201
            teacher_id, code = first.json()["id"], first.json()["link_code"]
            ids += [teacher_id, second.json()["id"]]

            # D2 y D3: el docente entra con la contraseña inicial y ve su código.
            first_login = _login(base, old_email, _PASSWORD)
            assert first_login.status_code == 200
            old_token = str(first_login.json()["access_token"])
            old_refresh = str(first_login.json()["refresh_token"])
            me = api.get("/v1/teacher/me", headers=_bearer(old_token))
            assert me.status_code == 200
            assert me.json() == {"name": "Profe Inicial", "link_code": code}

            # AD4: editar nombre y correo. El correo rige al instante, sin confirmación.
            edited = api.patch(
                f"/v1/admin/teachers/{teacher_id}",
                json={"name": "Profe Nueva", "email": new_email},
                headers=admin,
            )
            assert edited.status_code == 200, edited.text
            assert edited.json()["changed"] is True and edited.json()["link_code"] == code
            assert _login(base, new_email, _PASSWORD).status_code == 200  # entra con el nuevo
            assert _login(base, old_email, _PASSWORD).status_code == 400  # y no con el viejo
            # Las sesiones abiertas se cerraron: el token de refresco anterior ya no sirve.
            renew = httpx.post(
                f"{base}/auth/v1/token",
                params={"grant_type": "refresh_token"},
                headers={"apikey": _ANON},
                json={"refresh_token": old_refresh},
                timeout=20,
            )
            assert renew.status_code in (400, 401), renew.text
            again = api.get("/v1/teacher/me", headers=_bearer(_token(base, new_email)))
            assert again.json() == {"name": "Profe Nueva", "link_code": code}
            listed = api.get("/v1/admin/teachers", headers=admin).json()["teachers"]
            assert {
                "id": teacher_id,
                "name": "Profe Nueva",
                "email": new_email,
                "link_code": code,
            } in listed
            audit = rest.get(
                "/admin_audit",
                params={"target_id": f"eq.{teacher_id}", "action": "eq.teacher_updated"},
            ).json()
            assert len(audit) == 1 and audit[0]["admin_id"] == admin_id

            # Sin cambios: no se hace nada ni se registra. Correo de otra cuenta: 409 y no cambia.
            same = api.patch(
                f"/v1/admin/teachers/{teacher_id}", json={"name": "Profe Nueva"}, headers=admin
            )
            assert same.status_code == 200 and same.json()["changed"] is False
            clash = api.patch(
                f"/v1/admin/teachers/{teacher_id}", json={"email": other_email}, headers=admin
            )
            assert clash.status_code == 409
            assert _login(base, new_email, _PASSWORD).status_code == 200
            audit = rest.get(
                "/admin_audit",
                params={"target_id": f"eq.{teacher_id}", "action": "eq.teacher_updated"},
            ).json()
            assert len(audit) == 1  # ni lo igual ni el rechazo dejaron registro

            # AD5: eliminar. Ya no entra y su token, aún vigente, recibe 403.
            live_token = _token(base, new_email)
            assert api.get("/v1/teacher/me", headers=_bearer(live_token)).status_code == 200
            deleted = api.delete(f"/v1/admin/teachers/{teacher_id}", headers=admin)
            assert deleted.status_code == 204
            assert _login(base, new_email, _PASSWORD).status_code == 400
            assert api.get("/v1/teacher/me", headers=_bearer(live_token)).status_code == 403
            assert rest.get("/teachers", params={"id": f"eq.{teacher_id}"}).json() == []
            gone = rest.get(
                "/admin_audit",
                params={"target_id": f"eq.{teacher_id}", "action": "eq.teacher_deleted"},
            ).json()
            assert len(gone) == 1
            assert api.delete(f"/v1/admin/teachers/{teacher_id}", headers=admin).status_code == 404
    finally:
        for user_id in ids:
            auth.delete(f"/users/{user_id}")
