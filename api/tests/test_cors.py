"""CORS: lista explícita de orígenes, sin comodín y sin credenciales."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import FakeGateway

ORIGIN = "http://localhost:8100"


def _client() -> TestClient:
    settings = Settings(_env_file=None, app_env="test", supabase_jwt_secret="s" * 40)
    return TestClient(create_app(settings, gateway=FakeGateway()))


def test_origen_permitido_recibe_cabeceras_cors() -> None:
    response = _client().get("/healthz", headers={"Origin": ORIGIN})
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-credentials" not in response.headers


def test_origen_desconocido_no_recibe_cabeceras_cors() -> None:
    response = _client().get("/healthz", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_preflight_permite_la_cabecera_authorization() -> None:
    response = _client().options(
        "/healthz",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_el_comodin_se_rechaza() -> None:
    settings = Settings(_env_file=None, app_env="test", cors_origins="*")
    with pytest.raises(ValueError):
        _ = settings.cors_origin_list


def test_gemini_model_no_tiene_valor_por_defecto() -> None:
    assert Settings(_env_file=None).gemini_model == ""
