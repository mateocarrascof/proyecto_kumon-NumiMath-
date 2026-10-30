"""Borrar un perfil: solo con PIN verificado, solo perfiles propios, también si está bloqueado."""

from __future__ import annotations

import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import GatewayError
from app.main import create_app
from app.parental import issue_parental_token
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
SIGN = "clave-de-firma-de-ejercicios-solo-pruebas"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO_TUTOR = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
OTRO_PERFIL = uuid.UUID("22222222-bbbb-0000-0000-000000000002")


def _jwt(sub: uuid.UUID = TUTOR) -> str:
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _gateway() -> FakeGateway:
    # El perfil está BLOQUEADO: borrarlo debe funcionar igual (derecho de supresión).
    return FakeGateway(
        outcomes={(TUTOR, PERFIL): "student_blocked", (OTRO_TUTOR, OTRO_PERFIL): "ok"},
        grades={(TUTOR, PERFIL): 1, (OTRO_TUTOR, OTRO_PERFIL): 1},
    )


def _client(gateway: FakeGateway) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=SIGN,
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _h(sub: uuid.UUID = TUTOR, parental: bool = True) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {_jwt(sub)}"}
    if parental:
        headers["X-Parental-Token"] = issue_parental_token(SIGN.encode(), sub)
    return headers


def test_con_pin_borra_su_perfil_aunque_este_bloqueado() -> None:
    gateway = _gateway()
    response = _client(gateway).delete(f"/v1/students/{PERFIL}", headers=_h())
    assert response.status_code == 204
    assert gateway.deleted == [PERFIL]


def test_sin_pin_no_borra() -> None:
    gateway = _gateway()
    response = _client(gateway).delete(f"/v1/students/{PERFIL}", headers=_h(parental=False))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "parental_required"
    assert gateway.deleted == []


def test_un_perfil_ajeno_da_404_y_no_se_borra() -> None:
    gateway = _gateway()
    response = _client(gateway).delete(f"/v1/students/{OTRO_PERFIL}", headers=_h())
    assert response.status_code == 404
    assert gateway.deleted == []


def test_el_token_del_pin_de_otro_tutor_no_sirve() -> None:
    gateway = _gateway()
    headers = {
        "Authorization": f"Bearer {_jwt(TUTOR)}",
        "X-Parental-Token": issue_parental_token(SIGN.encode(), OTRO_TUTOR),
    }
    assert _client(gateway).delete(f"/v1/students/{PERFIL}", headers=headers).status_code == 401
    assert gateway.deleted == []


@pytest.mark.parametrize("malo", ["no-es-uuid", "123"])
def test_un_id_mal_formado_da_422(malo: str) -> None:
    assert _client(_gateway()).delete(f"/v1/students/{malo}", headers=_h()).status_code == 422


def test_si_la_base_falla_responde_503() -> None:
    gateway = _gateway()
    gateway.delete_error = GatewayError("transport")
    assert _client(gateway).delete(f"/v1/students/{PERFIL}", headers=_h()).status_code == 503
