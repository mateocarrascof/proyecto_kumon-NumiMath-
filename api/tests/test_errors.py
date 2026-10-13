from __future__ import annotations

import io

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.errors import ApiError

PII = "ana.perez@example.com"


class Echo(BaseModel):
    text: str
    n: int


def _with_test_routes(app: FastAPI) -> TestClient:
    @app.post("/_echo")
    async def echo(body: Echo) -> dict[str, str]:
        return {"text": body.text}

    @app.get("/_boom")
    async def boom() -> None:
        raise ValueError(f"fallo con datos del usuario: {PII}")

    @app.get("/_forbidden")
    async def forbidden() -> None:
        raise ApiError(403, "forbidden")

    return TestClient(app, raise_server_exceptions=False)


def test_validacion_no_repite_lo_que_envio_el_usuario(app: FastAPI) -> None:
    client = _with_test_routes(app)
    response = client.post("/_echo", json={"text": f"mi correo es {PII}", "n": "no es numero"})
    assert response.status_code == 422
    assert PII not in response.text
    body = response.json()["error"]
    assert body["code"] == "invalid_request"
    assert body["request_id"]


def test_error_no_controlado_es_generico_y_no_filtra_detalles(
    app: FastAPI, log_stream: io.StringIO
) -> None:
    client = _with_test_routes(app)
    response = client.get("/_boom")
    assert response.status_code == 500
    assert PII not in response.text
    assert "ValueError" not in response.text
    assert response.json()["error"]["code"] == "internal_error"
    # En los logs solo queda el TIPO de la excepción, no su texto.
    logs = log_stream.getvalue()
    assert PII not in logs
    assert "unhandled_error" in logs


def test_api_error_devuelve_codigo_y_mensaje_genericos(app: FastAPI) -> None:
    client = _with_test_routes(app)
    response = client.get("/_forbidden")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    assert response.json()["error"]["message"] == "No tienes acceso a este recurso."
