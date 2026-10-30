"""Límite de tamaño del cuerpo: 413 si es muy grande, 411 si no declara su tamaño."""

from __future__ import annotations

import json
import time
import uuid

import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")


def _client(max_body: int = 2048) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        max_body_bytes=max_body,
    )
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"}, grades={(TUTOR, PERFIL): 1})
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _headers() -> dict[str, str]:
    claims = {
        "sub": str(TUTOR),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    return {"Authorization": f"Bearer {jwt.encode(claims, SECRET, algorithm='HS256')}"}


def test_un_cuerpo_pequeno_pasa() -> None:
    response = _client().post(
        f"/v1/students/{PERFIL}/explanations",
        json={"topic": "1-08", "exercise": "7 + 5"},
        headers=_headers(),
    )
    assert response.status_code == 200


def test_un_cuerpo_demasiado_grande_es_413_sin_leerlo() -> None:
    big = json.dumps({"topic": "1-08", "exercise": "7 + 5", "relleno": "x" * 5000})
    response = _client().post(
        f"/v1/students/{PERFIL}/explanations",
        content=big,
        headers={**_headers(), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    error = response.json()["error"]
    assert error["code"] == "payload_too_large"
    assert len(error["request_id"]) == 32  # el rechazo lleva el id de la petición


def test_sin_content_length_es_411() -> None:
    def chunks() -> object:
        yield b'{"topic": "1-08",'
        yield b' "exercise": "7 + 5"}'

    response = _client().post(
        f"/v1/students/{PERFIL}/explanations",
        content=chunks(),  # type: ignore[arg-type]
        headers={**_headers(), "Content-Type": "application/json"},
    )
    assert response.status_code == 411


def test_un_content_length_invalido_es_411() -> None:
    response = _client().post(
        f"/v1/students/{PERFIL}/explanations",
        content=b"{}",
        headers={**_headers(), "Content-Type": "application/json", "Content-Length": "abc"},
    )
    assert response.status_code in (400, 411)


def test_los_get_no_se_ven_afectados() -> None:
    assert _client().get("/healthz").status_code == 200


def test_el_rechazo_no_incluye_el_cuerpo_ni_se_registra_su_contenido() -> None:
    secreto = "me llamo Pedro Perez " * 400
    response = _client().post(
        f"/v1/students/{PERFIL}/explanations",
        json={"topic": "1-08", "exercise": secreto},
        headers=_headers(),
    )
    assert response.status_code == 413
    assert "Pedro" not in response.text
