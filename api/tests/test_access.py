from __future__ import annotations

import io
import time
import uuid
from typing import Any

import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import FakeGateway, gateway_down

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO_TUTOR = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")


def _token(sub: uuid.UUID = TUTOR) -> str:
    now = int(time.time())
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": now + 600,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _client(gateway: FakeGateway) -> TestClient:
    settings = Settings(
        _env_file=None, app_env="test", supabase_url=URL, supabase_jwt_secret=SECRET
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _access(client: TestClient, student: uuid.UUID = PERFIL, **kwargs: Any) -> Any:
    headers = kwargs.pop("headers", {"Authorization": f"Bearer {_token()}"})
    return client.get(f"/v1/students/{student}/access", headers=headers, **kwargs)


def test_perfil_propio_con_consentimiento_se_autoriza() -> None:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"})
    response = _access(_client(gateway))
    assert response.status_code == 200
    assert response.json() == {"authorized": True}
    assert gateway.calls == [(TUTOR, PERFIL)]


def test_el_tutor_sale_del_jwt_y_no_de_la_peticion() -> None:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"})
    # Intento de suplantación: otro tutor en la consulta y en cabeceras.
    response = _access(
        _client(gateway),
        params={"tutor_id": str(OTRO_TUTOR)},
        headers={"Authorization": f"Bearer {_token()}", "X-Tutor-Id": str(OTRO_TUTOR)},
    )
    assert response.status_code == 200
    assert gateway.calls == [(TUTOR, PERFIL)]


def test_perfil_de_otro_tutor_o_inexistente_es_403_generico() -> None:
    gateway = FakeGateway(default="student_not_found")
    response = _access(_client(gateway))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_perfil_bloqueado_es_indistinguible_de_uno_ajeno() -> None:
    inexistente = _access(_client(FakeGateway(default="student_not_found")))
    bloqueado = _access(_client(FakeGateway(default="student_blocked")))
    assert bloqueado.status_code == inexistente.status_code == 403

    def sin_request_id(body: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in body["error"].items() if k != "request_id"}

    assert sin_request_id(bloqueado.json()) == sin_request_id(inexistente.json())


def test_sin_consentimiento_vigente_es_403_consent_required() -> None:
    response = _access(_client(FakeGateway(default="consent_required")))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "consent_required"


def test_si_la_base_falla_se_deniega() -> None:
    response = _access(_client(gateway_down()))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


def test_un_error_inesperado_tambien_deniega() -> None:
    gateway = FakeGateway(error=RuntimeError("explotó"))
    response = _access(_client(gateway))
    assert response.status_code == 500
    assert "authorized" not in response.text


def test_una_respuesta_desconocida_de_la_base_se_trata_como_no_autorizado() -> None:
    for raro in ("OK", "ok ", "", "allowed", "true"):
        response = _access(_client(FakeGateway(default=raro)))
        assert response.status_code == 403, raro


def test_sin_token_no_se_consulta_la_base() -> None:
    gateway = FakeGateway(default="ok")
    response = _client(gateway).get(f"/v1/students/{PERFIL}/access")
    assert response.status_code == 401
    assert gateway.calls == []


def test_un_id_de_perfil_invalido_no_llega_a_la_base() -> None:
    gateway = FakeGateway(default="ok")
    response = _client(gateway).get(
        "/v1/students/no-es-un-uuid/access", headers={"Authorization": f"Bearer {_token()}"}
    )
    assert response.status_code == 422
    assert gateway.calls == []


def test_los_logs_tienen_codigos_pero_no_identificadores(log_stream: io.StringIO) -> None:
    _access(_client(FakeGateway(default="student_blocked")))
    logs = log_stream.getvalue()
    assert "student_blocked" in logs
    assert str(PERFIL) not in logs
    assert str(TUTOR) not in logs


def test_el_cliente_http_de_la_base_se_cierra_al_apagar() -> None:
    gateway = FakeGateway(default="ok")
    settings = Settings(
        _env_file=None, app_env="test", supabase_url=URL, supabase_jwt_secret=SECRET
    )
    with TestClient(create_app(settings, gateway=gateway)) as client:
        assert client.get("/healthz").status_code == 200
    assert gateway.closed is True
