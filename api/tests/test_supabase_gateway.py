from __future__ import annotations

import json
import uuid

import httpx
import pytest
import respx

from app.config import Settings
from app.db.gateway import GatewayError
from app.db.supabase_gateway import SupabaseGateway

URL = "http://127.0.0.1:54321"
KEY = "sb_secret_CLAVE_DE_PRUEBA_NO_REAL_123"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")


def _gateway(key: str = KEY) -> SupabaseGateway:
    settings = Settings(
        _env_file=None, app_env="test", supabase_url=URL, supabase_service_role_key=key
    )
    return SupabaseGateway(settings)


RPC = f"{URL}/rest/v1/rpc/authorize_student_use"


@respx.mock
async def test_envia_la_llamada_rpc_con_la_llave_de_servidor() -> None:
    route = respx.post(RPC).mock(return_value=httpx.Response(200, json="ok"))
    assert await _gateway().authorize_student_use(TUTOR, PERFIL) == "ok"

    request = route.calls.last.request
    assert json.loads(request.content) == {"p_tutor_id": str(TUTOR), "p_student_id": str(PERFIL)}
    assert request.headers["apikey"] == KEY
    assert request.headers["authorization"] == f"Bearer {KEY}"


@respx.mock
@pytest.mark.parametrize("codigo", ["student_not_found", "student_blocked", "consent_required"])
async def test_devuelve_el_codigo_de_la_base(codigo: str) -> None:
    respx.post(RPC).mock(return_value=httpx.Response(200, json=codigo))
    assert await _gateway().authorize_student_use(TUTOR, PERFIL) == codigo


@respx.mock
@pytest.mark.parametrize("status", [400, 401, 404, 500, 503])
async def test_un_estado_http_de_error_falla_cerrado(status: int) -> None:
    respx.post(RPC).mock(return_value=httpx.Response(status, json={"message": "algo"}))
    with pytest.raises(GatewayError) as error:
        await _gateway().authorize_student_use(TUTOR, PERFIL)
    assert error.value.reason == f"status_{status}"


@respx.mock
async def test_un_timeout_falla_cerrado() -> None:
    respx.post(RPC).mock(side_effect=httpx.ConnectTimeout("tiempo agotado"))
    with pytest.raises(GatewayError) as error:
        await _gateway().authorize_student_use(TUTOR, PERFIL)
    assert error.value.reason == "transport"


@respx.mock
async def test_el_error_de_transporte_no_conserva_url_ni_llave() -> None:
    respx.post(RPC).mock(side_effect=httpx.ConnectError(f"no conecta con {URL} usando {KEY}"))
    with pytest.raises(GatewayError) as error:
        await _gateway().authorize_student_use(TUTOR, PERFIL)
    assert KEY not in str(error.value)
    assert URL not in str(error.value)
    assert error.value.__cause__ is None


@respx.mock
@pytest.mark.parametrize("cuerpo", [json.dumps({"ok": True}), json.dumps(True), json.dumps(None)])
async def test_un_resultado_que_no_es_texto_falla_cerrado(cuerpo: str) -> None:
    respx.post(RPC).mock(return_value=httpx.Response(200, content=cuerpo))
    with pytest.raises(GatewayError):
        await _gateway().authorize_student_use(TUTOR, PERFIL)


@respx.mock
async def test_un_cuerpo_que_no_es_json_falla_cerrado() -> None:
    respx.post(RPC).mock(return_value=httpx.Response(200, content=b"<html>error</html>"))
    with pytest.raises(GatewayError) as error:
        await _gateway().authorize_student_use(TUTOR, PERFIL)
    assert error.value.reason == "bad_json"


@respx.mock
async def test_sin_llave_configurada_no_se_hace_ninguna_llamada() -> None:
    route = respx.post(RPC).mock(return_value=httpx.Response(200, json="ok"))
    with pytest.raises(GatewayError) as error:
        await _gateway(key="").authorize_student_use(TUTOR, PERFIL)
    assert error.value.reason == "not_configured"
    assert route.call_count == 0


@respx.mock
async def test_assert_read_committed_acepta_200_y_204() -> None:
    url = f"{URL}/rest/v1/rpc/assert_read_committed"
    respx.post(url).mock(return_value=httpx.Response(204))
    await _gateway().assert_read_committed()
    respx.post(url).mock(return_value=httpx.Response(200, json=None))
    await _gateway().assert_read_committed()


@respx.mock
async def test_assert_read_committed_falla_si_la_base_lo_rechaza() -> None:
    url = f"{URL}/rest/v1/rpc/assert_read_committed"
    respx.post(url).mock(
        return_value=httpx.Response(400, json={"message": "isolation_level_not_allowed"})
    )
    with pytest.raises(GatewayError):
        await _gateway().assert_read_committed()
