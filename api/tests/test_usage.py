from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import httpx
import pytest
import respx

from app.access.authorize import AuthorizedStudent
from app.config import Settings
from app.db.gateway import GatewayError
from app.db.supabase_gateway import SupabaseGateway
from app.errors import ApiError
from app.usage.limits import UsagePolicy, consume_usage, seconds_until_reset
from tests.fakes import FakeGateway

TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
PERFIL_A = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
PERFIL_B = uuid.UUID("11111111-aaaa-0000-0000-000000000002")
POLICY = UsagePolicy(cost=1, student_limit=3, tutor_limit=5)


def _student(student_id: uuid.UUID = PERFIL_A) -> AuthorizedStudent:
    return AuthorizedStudent(tutor_id=TUTOR, student_id=student_id)


# --- política ----------------------------------------------------------------------------


def test_la_politica_sale_de_la_configuracion() -> None:
    settings = Settings(
        _env_file=None, cost_per_explanation=2, student_daily_limit=7, tutor_daily_limit=11
    )
    assert UsagePolicy.from_settings(settings) == UsagePolicy(
        cost=2, student_limit=7, tutor_limit=11
    )


def test_los_limites_por_defecto_son_los_decididos() -> None:
    policy = UsagePolicy.from_settings(Settings(_env_file=None))
    assert (policy.cost, policy.student_limit, policy.tutor_limit) == (1, 30, 90)


# --- consumo -----------------------------------------------------------------------------


async def test_consume_pasa_costo_y_limites_a_la_base() -> None:
    gateway = FakeGateway()
    await consume_usage(gateway, _student(), POLICY)
    assert gateway.usage_calls == [(TUTOR, PERFIL_A, 1, 3, 5)]


async def test_el_cuarto_uso_del_perfil_supera_su_limite() -> None:
    gateway = FakeGateway()
    for _ in range(3):
        await consume_usage(gateway, _student(), POLICY)
    with pytest.raises(ApiError) as error:
        await consume_usage(gateway, _student(), POLICY)
    assert error.value.status_code == 429
    assert error.value.code == "rate_limited"
    assert error.value.extra == {"scope": "student"}
    assert gateway.student_used[PERFIL_A] == 3  # el rechazado no consumió nada


async def test_el_tope_del_tutor_se_comparte_entre_perfiles() -> None:
    gateway = FakeGateway()
    for _ in range(3):
        await consume_usage(gateway, _student(PERFIL_A), POLICY)
    for _ in range(2):
        await consume_usage(gateway, _student(PERFIL_B), POLICY)  # tutor: 5 de 5
    with pytest.raises(ApiError) as error:
        await consume_usage(gateway, _student(PERFIL_B), POLICY)
    assert error.value.extra == {"scope": "tutor"}


async def test_un_perfil_nuevo_no_reinicia_el_tope_del_tutor() -> None:
    # Crear y borrar perfiles da identificadores nuevos: la cuota del tutor se mantiene.
    gateway = FakeGateway()
    for _ in range(3):
        await consume_usage(gateway, _student(PERFIL_A), POLICY)
    for _ in range(2):
        await consume_usage(gateway, _student(PERFIL_B), POLICY)
    perfil_nuevo = uuid.uuid4()
    with pytest.raises(ApiError) as error:
        await consume_usage(gateway, _student(perfil_nuevo), POLICY)
    assert error.value.extra == {"scope": "tutor"}


async def test_el_rechazo_trae_retry_after_y_mensaje_amable() -> None:
    gateway = FakeGateway(usage_override="student_limit")
    with pytest.raises(ApiError) as error:
        await consume_usage(
            gateway, _student(), POLICY, now=datetime(2026, 10, 15, 20, 0, tzinfo=UTC)
        )
    retry = int(error.value.headers["Retry-After"])
    assert retry == 8 * 3600  # hasta las 04:00 UTC del día siguiente


async def test_si_la_base_falla_se_deniega_con_503() -> None:
    gateway = FakeGateway(usage_error=GatewayError("transport"))
    with pytest.raises(ApiError) as error:
        await consume_usage(gateway, _student(), POLICY)
    assert error.value.status_code == 503
    assert error.value.code == "service_unavailable"


@pytest.mark.parametrize("raro", ["OK", "", "unlimited", "student_limit "])
async def test_una_respuesta_desconocida_deniega(raro: str) -> None:
    gateway = FakeGateway(usage_override=raro)
    with pytest.raises(ApiError) as error:
        await consume_usage(gateway, _student(), POLICY)
    assert error.value.status_code == 503


# --- Retry-After -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("ahora", "esperado"),
    [
        (datetime(2026, 10, 15, 3, 0, 0, tzinfo=UTC), 3600),
        (datetime(2026, 10, 15, 4, 0, 0, tzinfo=UTC), 86400),  # justo en el reinicio: el siguiente
        (datetime(2026, 10, 15, 3, 59, 59, tzinfo=UTC), 60),  # mínimo de 60 s
        (datetime(2026, 10, 15, 12, 30, 0, tzinfo=UTC), 15 * 3600 + 1800),
    ],
)
def test_segundos_hasta_el_reinicio(ahora: datetime, esperado: int) -> None:
    assert seconds_until_reset(ahora) == esperado


def test_retry_after_sin_hora_explicita_es_razonable() -> None:
    assert 60 <= seconds_until_reset() <= 86400


# --- transporte real (simulado) ------------------------------------------------------------

URL = "http://127.0.0.1:54321"
RPC = f"{URL}/rest/v1/rpc/consume_usage"
KEY = "sb_secret_CLAVE_DE_PRUEBA_NO_REAL_123"


def _gateway() -> SupabaseGateway:
    return SupabaseGateway(
        Settings(_env_file=None, app_env="test", supabase_url=URL, supabase_service_role_key=KEY)
    )


@respx.mock
async def test_la_llamada_rpc_lleva_los_parametros_de_la_base() -> None:
    route = respx.post(RPC).mock(return_value=httpx.Response(200, json="ok"))
    assert await _gateway().consume_usage(TUTOR, PERFIL_A, 1, 30, 90) == "ok"
    assert json.loads(route.calls.last.request.content) == {
        "p_tutor_id": str(TUTOR),
        "p_student_id": str(PERFIL_A),
        "p_cost": 1,
        "p_student_limit": 30,
        "p_tutor_limit": 90,
    }


@respx.mock
@pytest.mark.parametrize("codigo", ["ok", "student_limit", "tutor_limit"])
async def test_devuelve_los_tres_codigos_validos(codigo: str) -> None:
    respx.post(RPC).mock(return_value=httpx.Response(200, json=codigo))
    assert await _gateway().consume_usage(TUTOR, PERFIL_A, 1, 30, 90) == codigo


@respx.mock
@pytest.mark.parametrize("cuerpo", ['"otro"', "true", "null", "42", '{"ok": true}'])
async def test_cualquier_otro_resultado_falla_cerrado(cuerpo: str) -> None:
    respx.post(RPC).mock(return_value=httpx.Response(200, content=cuerpo))
    with pytest.raises(GatewayError):
        await _gateway().consume_usage(TUTOR, PERFIL_A, 1, 30, 90)


@respx.mock
async def test_un_error_de_la_base_falla_cerrado() -> None:
    respx.post(RPC).mock(return_value=httpx.Response(400, json={"message": "student_not_found"}))
    with pytest.raises(GatewayError) as error:
        await _gateway().consume_usage(TUTOR, PERFIL_A, 1, 30, 90)
    assert error.value.reason == "status_400"
