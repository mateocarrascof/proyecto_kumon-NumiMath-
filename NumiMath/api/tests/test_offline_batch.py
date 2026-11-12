"""Lote sin conexión (CU-A12, ADR 0002): contenido, tokens de dominio propio, solución en hash,
límite diario, comprobaciones de acceso y que manipular el lote no sirva."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import time
import uuid
from collections import Counter
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import GatewayError
from app.exercises.levels import SkillProgress
from app.exercises.offline import batch_levels, canonical
from app.exercises.tokens import InvalidExercise, issue, verify
from app.main import create_app
from app.safety.input_filter import check_input
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
SIGN = "clave-de-firma-de-ejercicios-solo-pruebas"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO_TUTOR = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
OTRO_PERFIL = uuid.UUID("22222222-bbbb-0000-0000-000000000002")
KEY = SIGN.encode()
WEEK = 7 * 24 * 3600


def _jwt(sub: uuid.UUID = TUTOR) -> str:
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _gateway(grade: int = 1) -> FakeGateway:
    return FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok", (OTRO_TUTOR, OTRO_PERFIL): "ok"},
        grades={(TUTOR, PERFIL): grade, (OTRO_TUTOR, OTRO_PERFIL): grade},
    )


def _client(gateway: FakeGateway, **extra: Any) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=SIGN,
        **extra,
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _batch(client: TestClient, student: uuid.UUID = PERFIL, sub: uuid.UUID = TUTOR) -> Any:
    return client.post(
        f"/v1/students/{student}/offline-batch", headers={"Authorization": f"Bearer {_jwt(sub)}"}
    )


def _hash(salt: str, value: str) -> str:
    return hashlib.sha256(f"{salt}|{value}".encode()).hexdigest()


# ---- Contenido del lote ---------------------------------------------------------------------


def test_lote_trae_solo_habilidades_del_curso_y_10_por_nivel_vecino() -> None:
    gateway = _gateway(grade=2)
    gateway.progress[PERFIL] = {"2-06": SkillProgress(level=2, block_total=4, block_correct=3)}
    response = _batch(_client(gateway))
    assert response.status_code == 200
    body = response.json()
    assert body["topics"], "el lote no puede venir vacío"
    # Sin repaso: solo habilidades de 2° básico.
    assert {t["grade"] for t in body["topics"]} == {2}
    by_topic = Counter((e["topic"], e["level"]) for e in body["exercises"])
    for topic in body["topics"]:
        levels = batch_levels(topic["level"])
        for level in levels:
            assert by_topic[(topic["id"], level)] == 10
        assert {lv for (t, lv) in by_topic if t == topic["id"]} == set(levels)
    sumas = next(t for t in body["topics"] if t["id"] == "2-06")
    assert (sumas["level"], sumas["block_done"], sumas["block_correct"]) == (2, 4, 3)


def test_niveles_vecinos() -> None:
    assert batch_levels(1) == [1, 2]
    assert batch_levels(2) == [1, 2, 3]
    assert batch_levels(3) == [2, 3]


def test_tokens_del_lote_son_validos_7_dias_y_el_hash_coincide_con_la_solucion() -> None:
    before = int(time.time())
    body = _batch(_client(_gateway())).json()
    assert before + WEEK <= body["expires_at"] <= int(time.time()) + WEEK
    for item in body["exercises"]:
        verified = verify(KEY, item["token"], PERFIL, offline=True)
        assert verified.topic == item["topic"]
        assert verified.level == item["level"]
        assert verified.exercise.text == item["text"]
        assert (item["answer_kind"] == "fraction") == verified.exercise.is_fraction
        expected = canonical(verified.exercise.answer, verified.exercise.answer_den)
        assert item["solution_hash"] == _hash(body["salt"], expected)
        # La respuesta no viaja en claro en ninguna parte del ejercicio.
        assert "answer" not in item


@pytest.mark.parametrize("grade", [1, 2, 3, 4])
def test_todo_ejercicio_del_lote_pasa_el_filtro_rnf10(grade: int) -> None:
    """RNF-10: el lote sale del mismo generador validado; cada enunciado pasa el filtro."""
    body = _batch(_client(_gateway(grade=grade))).json()
    rejected = [e["text"] for e in body["exercises"] if not check_input(e["text"]).allowed]
    assert rejected == []


def test_token_del_lote_caduca_a_los_7_dias() -> None:
    body = _batch(_client(_gateway())).json()
    token = body["exercises"][0]["token"]
    verify(KEY, token, PERFIL, now=body["expires_at"] - 1, offline=True)
    with pytest.raises(InvalidExercise):
        verify(KEY, token, PERFIL, now=body["expires_at"], offline=True)


def test_sin_enunciados_repetidos_dentro_de_un_nivel_cuando_hay_otros() -> None:
    body = _batch(_client(_gateway(grade=3))).json()
    texts: dict[tuple[str, int], list[str]] = {}
    for e in body["exercises"]:
        texts.setdefault((e["topic"], e["level"]), []).append(e["text"])
    # Las sumas y restas de 3° tienen muchísimos enunciados posibles: no deben repetirse.
    for (topic, _level), values in texts.items():
        if topic == "3-06":
            assert len(set(values)) == len(values)


def test_fracciones_en_forma_simple() -> None:
    assert canonical(6, 10) == "3/5"
    assert canonical(0, 4) == "0/1"
    assert canonical(12, None) == "12"


def test_sal_distinta_en_cada_lote() -> None:
    client = _client(_gateway())
    assert _batch(client).json()["salt"] != _batch(client).json()["salt"]


# ---- Dominio propio: un token no sirve donde no corresponde ---------------------------------


def test_token_del_lote_no_sirve_para_responder_en_linea() -> None:
    client = _client(_gateway())
    token = _batch(client).json()["exercises"][0]["token"]
    response = client.post(
        f"/v1/students/{PERFIL}/exercises/answer",
        json={"token": token, "answer": 1},
        headers={"Authorization": f"Bearer {_jwt()}"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "exercise_invalid"


def test_token_de_practica_o_diagnostico_no_es_del_lote() -> None:
    practice = issue(KEY, PERFIL, "1-08", 600)
    diagnostic = issue(KEY, PERFIL, "1-08", 600, step=0)
    assert practice is not None and diagnostic is not None
    for token in (practice.token, diagnostic.token):
        with pytest.raises(InvalidExercise):
            verify(KEY, token, PERFIL, offline=True)


def test_no_se_combina_lote_y_diagnostico() -> None:
    assert issue(KEY, PERFIL, "1-08", 600, step=0, offline=True) is None
    offline = issue(KEY, PERFIL, "1-08", 600, offline=True)
    assert offline is not None
    with pytest.raises(InvalidExercise):
        verify(KEY, offline.token, PERFIL, diagnostic=True, offline=True)


# ---- Manipulación del lote local ------------------------------------------------------------


def _tamper(token: str, **changes: Any) -> str:
    payload_b64, signature = token.split(".")
    payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
    payload.update(changes)
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode() + "." + signature


@pytest.mark.parametrize(
    "changes",
    [{"l": 1}, {"t": "1-01"}, {"e": 4_102_444_800}, {"s": str(OTRO_PERFIL)}, {"v": 4}],
)
def test_cambiar_nivel_tema_caducidad_o_perfil_del_token_rompe_la_firma(
    changes: dict[str, Any],
) -> None:
    gateway = _gateway()
    gateway.progress[PERFIL] = {"1-08": SkillProgress(level=3)}
    body = _batch(_client(gateway)).json()
    token = next(e["token"] for e in body["exercises"] if e["topic"] == "1-08" and e["level"] == 3)
    with pytest.raises(InvalidExercise):
        verify(KEY, _tamper(token, **changes), PERFIL, offline=True)


def test_el_lote_de_un_perfil_no_sirve_en_otro() -> None:
    token = _batch(_client(_gateway())).json()["exercises"][0]["token"]
    with pytest.raises(InvalidExercise):
        verify(KEY, token, OTRO_PERFIL, offline=True)


def test_cambiar_el_hash_guardado_no_cambia_la_respuesta_que_regenera_el_servidor() -> None:
    """El hash es solo para la corrección provisional: la respuesta real sale del token."""
    body = _batch(_client(_gateway())).json()
    item = body["exercises"][0]
    original = verify(KEY, item["token"], PERFIL, offline=True).exercise
    item["solution_hash"] = _hash(body["salt"], "999999")
    assert verify(KEY, item["token"], PERFIL, offline=True).exercise == original


# ---- Acceso y límites -----------------------------------------------------------------------


def test_sin_jwt_401() -> None:
    response = _client(_gateway()).post(f"/v1/students/{PERFIL}/offline-batch")
    assert response.status_code == 401


def test_perfil_de_otro_tutor_403_sin_contar_descarga() -> None:
    gateway = _gateway()
    response = _batch(_client(gateway), student=OTRO_PERFIL, sub=TUTOR)
    assert response.status_code == 403
    assert gateway.offline_batches == {}


@pytest.mark.parametrize("outcome", ["student_blocked", "consent_required"])
def test_perfil_bloqueado_o_sin_consentimiento_403(outcome: str) -> None:
    gateway = _gateway()
    gateway.outcomes[(TUTOR, PERFIL)] = outcome
    assert _batch(_client(gateway)).status_code == 403
    assert gateway.offline_batches == {}


def test_limite_de_5_descargas_por_perfil_al_dia() -> None:
    gateway = _gateway()
    client = _client(gateway)
    for _ in range(5):
        assert _batch(client).status_code == 200
    response = _batch(client)
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "offline_batch_limit"
    # El límite es por perfil: otro tutor con su perfil sigue pudiendo.
    assert _batch(client, student=OTRO_PERFIL, sub=OTRO_TUTOR).status_code == 200


def test_falla_del_limite_503() -> None:
    gateway = _gateway()
    gateway.offline_batch_error = GatewayError("transport")
    assert _batch(_client(gateway)).status_code == 503


def test_sin_progreso_no_hay_lote_falla_cerrado() -> None:
    gateway = _gateway()
    gateway.levels_error = GatewayError("transport")
    response = _batch(_client(gateway))
    assert response.status_code == 503
    # Hallazgo de revisión: la descarga no se cuenta si no se pudo entregar el lote.
    assert gateway.offline_batches == {}


def test_tras_una_falla_del_progreso_siguen_las_5_descargas_del_dia() -> None:
    gateway = _gateway()
    client = _client(gateway)
    gateway.levels_error = GatewayError("transport")
    for _ in range(3):
        assert _batch(client).status_code == 503
    gateway.levels_error = None
    for _ in range(5):
        assert _batch(client).status_code == 200


def test_sin_clave_de_firma_503() -> None:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key="",
    )
    client = TestClient(create_app(settings, gateway=_gateway()), raise_server_exceptions=False)
    assert _batch(client).status_code == 503


def test_logs_sin_enunciados_ni_tokens(caplog: pytest.LogCaptureFixture) -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logging.getLogger("mathtutor").addHandler(handler)
    try:
        with caplog.at_level(logging.INFO, logger="mathtutor"):
            body = _batch(_client(_gateway())).json()
    finally:
        logging.getLogger("mathtutor").removeHandler(handler)
    logged = stream.getvalue() + caplog.text
    assert "offline_batch.issued" in logged
    for item in body["exercises"][:20]:
        assert item["text"] not in logged
        assert item["token"] not in logged
    assert body["salt"] not in logged
