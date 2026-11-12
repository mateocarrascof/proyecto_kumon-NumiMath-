from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime

import httpx
import pytest
import respx

from app.config import Settings
from app.db.gateway import DiagnosticItem, GatewayError, OfflineAttempt
from app.db.supabase_gateway import SupabaseGateway
from app.exercises.levels import SkillProgress

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


ATTEMPTS = f"{URL}/rest/v1/student_attempts"


PROGRESS = f"{URL}/rest/v1/student_skill_progress"


@respx.mock
async def test_list_skill_progress_acota_por_tutor_y_perfil() -> None:
    fila = {
        "skill_code": "1-08",
        "level": 2,
        "block_total": 4,
        "block_correct": 3,
        "mastered_at": None,
    }
    dominada = {**fila, "skill_code": "1-06", "level": 3, "mastered_at": "2026-10-27T10:00:00Z"}
    route = respx.get(PROGRESS).mock(return_value=httpx.Response(200, json=[fila, dominada]))
    progreso = await _gateway().list_skill_progress(TUTOR, PERFIL)
    assert progreso["1-08"] == SkillProgress(2, 4, 3, False)
    assert progreso["1-06"].mastered is True
    params = route.calls.last.request.url.params
    assert params["tutor_id"] == f"eq.{TUTOR}"
    assert params["student_id"] == f"eq.{PERFIL}"


@respx.mock
@pytest.mark.parametrize(
    "cuerpo",
    [
        {"x": 1},
        [{"skill_code": "1-08", "level": "2", "block_total": 0, "block_correct": 0}],
        [{"skill_code": "1-08", "level": 4, "block_total": 0, "block_correct": 0}],
        [{"skill_code": "1-08", "level": 1, "block_total": 10, "block_correct": 0}],
        [{"skill_code": "1-08", "level": 1, "block_total": 2, "block_correct": 3}],
        [{"skill_code": 8, "level": 1, "block_total": 0, "block_correct": 0}],
        [{"level": 1}],
    ],
)
async def test_list_skill_progress_falla_cerrado_con_filas_raras(cuerpo: object) -> None:
    if isinstance(cuerpo, list):
        cuerpo = [{**fila, "mastered_at": None} for fila in cuerpo]
    respx.get(PROGRESS).mock(return_value=httpx.Response(200, json=cuerpo))
    with pytest.raises(GatewayError):
        await _gateway().list_skill_progress(TUTOR, PERFIL)


@respx.mock
async def test_list_recent_exercises_acota_por_tutor_perfil_y_tema() -> None:
    route = respx.get(ATTEMPTS).mock(
        return_value=httpx.Response(200, json=[{"exercise": "5 + 6 = ?"}])
    )
    assert await _gateway().list_recent_exercises(TUTOR, PERFIL, "1-08", 3) == ["5 + 6 = ?"]
    params = route.calls.last.request.url.params
    assert params["tutor_id"] == f"eq.{TUTOR}"
    assert params["student_id"] == f"eq.{PERFIL}"
    assert params["topic"] == "eq.1-08"
    assert params["select"] == "exercise"
    assert params["limit"] == "3"
    # El bloque de 10 es solo de práctica: el diagnóstico (CU-A2) no cuenta.
    assert params["activity"] == "eq.practice"


@respx.mock
async def test_list_attempts_no_trae_el_diagnostico() -> None:
    route = respx.get(ATTEMPTS).mock(return_value=httpx.Response(200, json=[]))
    assert await _gateway().list_attempts(TUTOR, PERFIL, 500) == []
    params = route.calls.last.request.url.params
    assert params["activity"] == "eq.practice"
    assert params["tutor_id"] == f"eq.{TUTOR}"
    assert params["student_id"] == f"eq.{PERFIL}"


@respx.mock
async def test_save_diagnostic_envia_los_6_intentos() -> None:
    route = respx.post(f"{URL}/rest/v1/rpc/save_diagnostic").mock(
        return_value=httpx.Response(200, json="ok")
    )
    items = [
        DiagnosticItem(uuid.uuid4(), "2 + 3 = ?", step % 2 == 0, step // 2 + 1) for step in range(6)
    ]
    assert await _gateway().save_diagnostic(TUTOR, PERFIL, "1-08", 2, items) == "ok"
    body = json.loads(route.calls.last.request.content)
    assert body["p_tutor_id"] == str(TUTOR) and body["p_student_id"] == str(PERFIL)
    assert body["p_topic"] == "1-08" and body["p_level"] == 2
    assert [a["level"] for a in body["p_attempts"]] == [1, 1, 2, 2, 3, 3]
    assert body["p_attempts"][0]["exercise_id"] == str(items[0].exercise_id)


@respx.mock
@pytest.mark.parametrize("cuerpo", ["otra_cosa", 1, None])
async def test_save_diagnostic_falla_cerrado_con_resultados_raros(cuerpo: object) -> None:
    respx.post(f"{URL}/rest/v1/rpc/save_diagnostic").mock(
        return_value=httpx.Response(200, json=cuerpo)
    )
    with pytest.raises(GatewayError):
        await _gateway().save_diagnostic(TUTOR, PERFIL, "1-08", 1, [])


@respx.mock
@pytest.mark.parametrize("cuerpo", [{"x": 1}, [{"exercise": 5}], [{"otro": "x"}], ["texto"]])
async def test_list_recent_exercises_falla_cerrado_con_filas_raras(cuerpo: object) -> None:
    respx.get(ATTEMPTS).mock(return_value=httpx.Response(200, json=cuerpo))
    with pytest.raises(GatewayError):
        await _gateway().list_recent_exercises(TUTOR, PERFIL, "1-08", 3)


@respx.mock
async def test_record_attempt_envia_el_nivel() -> None:
    route = respx.post(f"{URL}/rest/v1/rpc/record_attempt").mock(
        return_value=httpx.Response(200, json="ok")
    )
    outcome = await _gateway().record_attempt(
        TUTOR, PERFIL, uuid.uuid4(), "1-08", "1 + 1 = ?", True, None, 3
    )
    assert outcome == "ok"
    assert json.loads(route.calls.last.request.content)["p_level"] == 3


# ---- Lote sin conexión (CU-A12): límite diario de descargas ----------------------------------

OFFLINE_RPC = f"{URL}/rest/v1/rpc/consume_offline_batch"


@respx.mock
@pytest.mark.parametrize("codigo", ["ok", "limit", "student_not_found"])
async def test_consume_offline_batch_envia_el_limite_y_devuelve_el_codigo(codigo: str) -> None:
    route = respx.post(OFFLINE_RPC).mock(return_value=httpx.Response(200, json=codigo))
    assert await _gateway().consume_offline_batch(TUTOR, PERFIL, 5) == codigo
    assert json.loads(route.calls.last.request.content) == {
        "p_tutor_id": str(TUTOR),
        "p_student_id": str(PERFIL),
        "p_daily_limit": 5,
    }


@respx.mock
@pytest.mark.parametrize("cuerpo", ["student_limit", True, None, {"ok": True}])
async def test_consume_offline_batch_falla_cerrado_con_respuestas_raras(cuerpo: object) -> None:
    respx.post(OFFLINE_RPC).mock(return_value=httpx.Response(200, json=cuerpo))
    with pytest.raises(GatewayError):
        await _gateway().consume_offline_batch(TUTOR, PERFIL, 5)


# ---- Sincronización sin conexión (CU-A13) ---------------------------------------------------

SYNC_RPC = f"{URL}/rest/v1/rpc/record_offline_attempts"
_JTI = uuid.UUID("cccccccc-0000-0000-0000-000000000001")


def _offline_attempt() -> OfflineAttempt:
    return OfflineAttempt(
        exercise_id=_JTI,
        topic="1-08",
        exercise="3 + 4 = ?",
        correct=True,
        level=1,
        duration_s=20,
        answered_at=datetime(2026, 11, 12, 10, 0, tzinfo=UTC),
        local_day=date(2026, 11, 12),
    )


@respx.mock
async def test_record_offline_attempts_envia_el_lote_en_una_llamada() -> None:
    route = respx.post(SYNC_RPC).mock(
        return_value=httpx.Response(200, json=[{"exercise_id": str(_JTI), "status": "ok"}])
    )
    assert await _gateway().record_offline_attempts(TUTOR, PERFIL, [_offline_attempt()]) == {
        _JTI: "ok"
    }
    body = json.loads(route.calls.last.request.content)
    assert body["p_student_id"] == str(PERFIL)
    assert body["p_attempts"][0]["exercise_id"] == str(_JTI)
    assert body["p_attempts"][0]["local_day"] == "2026-11-12"
    assert route.call_count == 1


@respx.mock
async def test_record_offline_attempts_perfil_ajeno_es_none() -> None:
    respx.post(SYNC_RPC).mock(return_value=httpx.Response(200, json="student_not_found"))
    assert await _gateway().record_offline_attempts(TUTOR, PERFIL, [_offline_attempt()]) is None


@respx.mock
@pytest.mark.parametrize(
    "cuerpo",
    [
        "ok",
        None,
        [{"exercise_id": "x", "status": "ok"}],
        [{"exercise_id": str(_JTI), "status": "raro"}],
    ],
)
async def test_record_offline_attempts_falla_cerrado_con_respuestas_raras(cuerpo: object) -> None:
    respx.post(SYNC_RPC).mock(return_value=httpx.Response(200, json=cuerpo))
    with pytest.raises(GatewayError):
        await _gateway().record_offline_attempts(TUTOR, PERFIL, [_offline_attempt()])
