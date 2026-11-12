"""CU-A9: preferencia de recordatorio de racha (solo el tutor, con PIN vigente)."""

from __future__ import annotations

import io
import json
import logging
import time
import uuid
from typing import Any

import httpx
import jwt
import pytest
import respx
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import GatewayError
from app.db.supabase_gateway import SupabaseGateway
from app.main import create_app
from app.parental import issue_parental_token
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
SIGN = "clave-de-firma-de-ejercicios-solo-pruebas"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO_TUTOR = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
OTRO_PERFIL = uuid.UUID("22222222-bbbb-0000-0000-000000000002")


def _headers(sub: uuid.UUID = TUTOR, parental: bool = True) -> dict[str, str]:
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    headers = {"Authorization": f"Bearer {jwt.encode(claims, SECRET, algorithm='HS256')}"}
    if parental:
        headers["X-Parental-Token"] = issue_parental_token(SIGN.encode(), sub)
    return headers


def _gateway() -> FakeGateway:
    return FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok", (OTRO_TUTOR, OTRO_PERFIL): "ok"},
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


def _put(client: TestClient, body: Any, student=PERFIL, **kw: Any) -> Any:
    return client.put(f"/v1/students/{student}/streak-reminder", json=body, headers=_headers(**kw))


def test_el_tutor_con_pin_lo_activa_y_desactiva() -> None:
    gateway = _gateway()
    client = _client(gateway)
    assert _put(client, {"enabled": True}).json() == {"enabled": True}
    assert gateway.streak_reminders[PERFIL] is True
    assert _put(client, {"enabled": False}).json() == {"enabled": False}
    assert gateway.streak_reminders[PERFIL] is False


def test_sin_pin_vigente_401_o_403_y_no_cambia() -> None:
    gateway = _gateway()
    response = _put(_client(gateway), {"enabled": True}, parental=False)
    assert response.status_code in (401, 403)
    assert gateway.streak_reminders == {}


def test_sin_jwt_401() -> None:
    response = _client(_gateway()).put(
        f"/v1/students/{PERFIL}/streak-reminder", json={"enabled": True}
    )
    assert response.status_code == 401


def test_perfil_de_otro_tutor_403() -> None:
    gateway = _gateway()
    assert _put(_client(gateway), {"enabled": True}, student=OTRO_PERFIL).status_code == 403
    assert gateway.streak_reminders == {}


@pytest.mark.parametrize("outcome", ["student_blocked", "consent_required"])
def test_perfil_en_pausa_o_sin_consentimiento_403(outcome: str) -> None:
    gateway = _gateway()
    gateway.outcomes[(TUTOR, PERFIL)] = outcome
    assert _put(_client(gateway), {"enabled": True}).status_code == 403
    assert gateway.streak_reminders == {}


@pytest.mark.parametrize("body", [{}, {"enabled": "si"}, {"enabled": True, "hora": "18:00"}])
def test_cuerpo_invalido_422(body: Any) -> None:
    assert _put(_client(_gateway()), body).status_code == 422


def test_falla_de_la_base_503() -> None:
    gateway = _gateway()
    gateway.streak_reminder_error = GatewayError("transport")
    assert _put(_client(gateway), {"enabled": True}).status_code == 503


def test_log_sin_perfil_ni_valor() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logger = logging.getLogger("mathtutor.reminders")
    logger.addHandler(handler)
    try:
        _put(_client(_gateway()), {"enabled": True})
    finally:
        logger.removeHandler(handler)
    text = stream.getvalue()
    assert "reminder.updated" in text
    assert str(PERFIL) not in text


# ---- Gateway (RPC) ----------------------------------------------------------------------------

RPC = f"{URL}/rest/v1/rpc/set_streak_reminder"


def _supabase() -> SupabaseGateway:
    return SupabaseGateway(
        Settings(
            _env_file=None,
            app_env="test",
            supabase_url=URL,
            supabase_service_role_key="clave-de-servicio-solo-pruebas",
        )
    )


@respx.mock
@pytest.mark.parametrize("codigo", ["ok", "student_not_found"])
async def test_rpc_envia_el_valor_y_devuelve_el_codigo(codigo: str) -> None:
    route = respx.post(RPC).mock(return_value=httpx.Response(200, json=codigo))
    assert await _supabase().set_streak_reminder(TUTOR, PERFIL, True) == codigo
    assert json.loads(route.calls.last.request.content) == {
        "p_tutor_id": str(TUTOR),
        "p_student_id": str(PERFIL),
        "p_enabled": True,
    }


@respx.mock
@pytest.mark.parametrize("cuerpo", ["si", None, True, {"ok": True}])
async def test_rpc_falla_cerrado_con_respuestas_raras(cuerpo: object) -> None:
    respx.post(RPC).mock(return_value=httpx.Response(200, json=cuerpo))
    with pytest.raises(GatewayError):
        await _supabase().set_streak_reminder(TUTOR, PERFIL, False)
