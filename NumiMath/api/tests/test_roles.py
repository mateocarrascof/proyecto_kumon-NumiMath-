"""Roles por `app_metadata.role`: cada dependencia acepta solo el suyo."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.deps import CurrentAdmin, CurrentTeacher, CurrentTutor
from app.main import create_app
from tests.test_auth import SECRET, TUTOR, _hs256, _settings


@pytest.fixture
def client() -> TestClient:
    app = create_app(_settings(supabase_jwt_secret=SECRET))

    @app.get("/_tutor")
    async def tutor(user: CurrentTutor) -> dict[str, str]:
        return {"id": str(user.tutor_id)}

    @app.get("/_teacher")
    async def teacher(user: CurrentTeacher) -> dict[str, str]:
        return {"id": str(user.tutor_id)}

    @app.get("/_admin")
    async def admin(user: CurrentAdmin) -> dict[str, str]:
        return {"id": str(user.tutor_id)}

    return TestClient(app, raise_server_exceptions=False)


def _status(client: TestClient, path: str, **claims: Any) -> int:
    return client.get(path, headers={"Authorization": f"Bearer {_hs256(**claims)}"}).status_code


TEACHER = {"app_metadata": {"role": "teacher"}}
ADMIN = {"app_metadata": {"role": "admin"}}


def test_tutor_sin_rol_solo_entra_a_rutas_de_tutor(client: TestClient) -> None:
    assert _status(client, "/_tutor") == 200
    assert _status(client, "/_teacher") == 403
    assert _status(client, "/_admin") == 403


def test_docente_no_entra_a_rutas_de_tutor_ni_de_admin(client: TestClient) -> None:
    assert _status(client, "/_teacher", **TEACHER) == 200
    assert _status(client, "/_tutor", **TEACHER) == 403
    assert _status(client, "/_admin", **TEACHER) == 403


def test_admin_no_entra_a_rutas_de_tutor_ni_de_docente(client: TestClient) -> None:
    assert _status(client, "/_admin", **ADMIN) == 200
    assert _status(client, "/_tutor", **ADMIN) == 403
    assert _status(client, "/_teacher", **ADMIN) == 403


def test_el_rol_de_user_metadata_no_cuenta(client: TestClient) -> None:
    # user_metadata lo escribe el propio usuario al registrarse: no da ningún rol.
    assert _status(client, "/_admin", user_metadata={"role": "admin"}) == 403
    assert _status(client, "/_tutor", user_metadata={"role": "admin"}) == 200


def test_rol_desconocido_no_es_tutor(client: TestClient) -> None:
    assert _status(client, "/_tutor", app_metadata={"role": "superuser"}) == 403
    assert _status(client, "/_admin", app_metadata={"role": "superuser"}) == 403


def test_rol_mal_formado_se_ignora_y_queda_como_tutor(client: TestClient) -> None:
    assert _status(client, "/_tutor", app_metadata={"role": ["admin"]}) == 200
    assert _status(client, "/_tutor", app_metadata="admin") == 200
    assert _status(client, "/_admin", app_metadata={"role": ["admin"]}) == 403


def test_sin_token_es_401_en_todas(client: TestClient) -> None:
    for path in ("/_tutor", "/_teacher", "/_admin"):
        assert client.get(path).status_code == 401


def test_el_id_es_el_sub_del_token(client: TestClient) -> None:
    response = client.get("/_admin", headers={"Authorization": f"Bearer {_hs256(**ADMIN)}"})
    assert response.json() == {"id": str(TUTOR)}
