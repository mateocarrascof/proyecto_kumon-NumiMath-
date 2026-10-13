from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_healthz_responde_ok(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_genera_request_id_si_no_viene(client: TestClient) -> None:
    response = client.get("/healthz")
    request_id = response.headers["X-Request-ID"]
    assert len(request_id) == 32


def test_conserva_un_request_id_valido(client: TestClient) -> None:
    response = client.get("/healthz", headers={"X-Request-ID": "abc-12345678"})
    assert response.headers["X-Request-ID"] == "abc-12345678"


def test_reemplaza_un_request_id_invalido(client: TestClient) -> None:
    # Un valor controlado por el cliente no debe acabar en los logs tal cual.
    response = client.get("/healthz", headers={"X-Request-ID": "ana@example.com\nINJECT"})
    assert response.headers["X-Request-ID"] != "ana@example.com\nINJECT"
    assert len(response.headers["X-Request-ID"]) == 32


def test_la_documentacion_no_se_expone_en_produccion() -> None:
    settings = Settings(
        _env_file=None,
        app_env="production",
        supabase_service_role_key="k",
        supabase_jwt_secret="s",
        hmac_keys=json.dumps({"1": "a" * 64}),
    )
    production = TestClient(create_app(settings))
    assert production.get("/docs").status_code == 404
    assert production.get("/openapi.json").status_code == 404
    assert production.get("/healthz").status_code == 200
