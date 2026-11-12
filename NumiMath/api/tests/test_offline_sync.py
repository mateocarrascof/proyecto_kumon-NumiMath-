"""CU-A13: sincronizar los intentos hechos sin conexión.

Cubre: duplicados (mismo lote y token ya respondido en línea), orden cronológico, lote parcial,
perfil ajeno, perfil bloqueado, valores manipulados (correct, level, topic, hora, fecha, tiempo),
margen de 14 días solo para tokens del lote, tamaño del lote, envíos simultáneos y logs.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.db.gateway import GatewayError
from app.exercises.levels import SkillProgress
from app.exercises.tokens import InvalidExercise, issue, verify
from tests.test_offline_batch import (
    KEY,
    OTRO_PERFIL,
    OTRO_TUTOR,
    PERFIL,
    TUTOR,
    WEEK,
    _client,
    _gateway,
    _jwt,
)

TOPIC = "1-08"
DAY = 24 * 3600
GRACE = 14 * DAY


def _token(level: int = 1, issued: float | None = None, student: uuid.UUID = PERFIL, **kw: Any):
    now = time.time() if issued is None else issued
    made = issue(KEY, student, TOPIC, WEEK, now=now, level=level, offline=True, **kw)
    assert made is not None
    return made


def _answer(token: str, student: uuid.UUID = PERFIL, now: float | None = None) -> int:
    return verify(KEY, token, student, now=now, offline=True, grace_s=GRACE).exercise.answer


def _item(token: str, right: bool = True, minutes_ago: int = 1, **extra: Any) -> dict[str, Any]:
    answer = _answer(token)
    at = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    return {
        "id": str(uuid.uuid4()),
        "token": token,
        "answer": answer if right else answer + 1,
        "answered_at": at.isoformat(),
        "local_date": at.date().isoformat(),
        "duration_s": 20,
        **extra,
    }


def _sync(client: Any, items: list[dict[str, Any]], student=PERFIL, sub=TUTOR) -> Any:
    return client.post(
        f"/v1/students/{student}/offline-sync",
        headers={"Authorization": f"Bearer {_jwt(sub)}"},
        json={"attempts": items},
    )


def _statuses(response: Any) -> list[str]:
    assert response.status_code == 200, response.text
    return [r["status"] for r in response.json()["results"]]


# ---- Registro y corrección ------------------------------------------------------------------


def test_registra_y_vuelve_a_corregir_en_el_servidor() -> None:
    gateway = _gateway()
    items = [_item(_token().token, right=True), _item(_token().token, right=False)]
    assert _statuses(_sync(_client(gateway), items)) == ["accepted", "accepted"]
    assert sorted(c for (_, _, c) in gateway.attempts.values()) == [False, True]
    assert gateway.progress[PERFIL][TOPIC] == SkillProgress(level=1, block_total=2, block_correct=1)


def test_valores_manipulados_correct_level_topic_se_ignoran() -> None:
    gateway = _gateway()
    item = _item(_token(level=1).token, right=False)
    item.update({"correct": True, "level": 3, "topic": "4-01"})
    assert _statuses(_sync(_client(gateway), [item])) == ["accepted"]
    ((topic, _, correct),) = gateway.attempts.values()
    assert (topic, correct) == (TOPIC, False)
    assert gateway.levels == [(PERFIL, TOPIC, 1, False)]


def test_hora_futura_o_anterior_al_token_se_acota_a_su_vida() -> None:
    gateway = _gateway()
    made = _token()
    future = _item(made.token, answered_at=(datetime.now(UTC) + timedelta(days=30)).isoformat())
    past_token = _token()
    past = _item(past_token.token, answered_at="2001-01-01T00:00:00+00:00")
    _sync(_client(gateway), [future, past])
    stamps = sorted(gateway.answered_at.values())
    assert all(s <= datetime.now(UTC) for s in stamps)
    assert all(s.year > 2001 for s in stamps)


def test_fecha_local_fuera_de_la_vida_del_token_no_mueve_la_racha() -> None:
    gateway = _gateway()
    _sync(_client(gateway), [_item(_token().token, local_date="2030-01-01")])
    assert PERFIL not in gateway.streaks


def test_tiempo_sobre_600_s_se_guarda_sin_tiempo() -> None:
    gateway = _gateway()
    _sync(_client(gateway), [_item(_token().token, duration_s=601)])
    assert gateway.durations == [None]


# ---- Orden cronológico y racha --------------------------------------------------------------


def test_orden_cronologico_aunque_lleguen_desordenados() -> None:
    gateway = _gateway()
    # 10 aciertos en nivel 1 (hace 100 a 91 min) y uno en nivel 2 (hace 5 min), enviado PRIMERO.
    two_hours_ago = time.time() - 7200
    later = _item(_token(level=2, issued=two_hours_ago).token, minutes_ago=5)
    block = [
        _item(_token(level=1, issued=two_hours_ago).token, minutes_ago=100 - g) for g in range(10)
    ]
    _sync(_client(gateway), [later, *block])
    assert gateway.progress[PERFIL][TOPIC] == SkillProgress(level=2, block_total=1, block_correct=1)


def test_racha_por_dia_local_en_orden() -> None:
    gateway = _gateway()
    start = time.time() - 3 * DAY
    items = []
    for d in (3, 2, 1):
        made = _token(issued=start)
        at = datetime.now(UTC) - timedelta(days=d)
        items.append(
            _item(made.token, answered_at=at.isoformat(), local_date=at.date().isoformat())
        )
    _sync(_client(gateway), list(reversed(items)))
    assert gateway.streaks[PERFIL].current_len == 3


# ---- Duplicados -----------------------------------------------------------------------------


def test_reenviar_el_mismo_lote_no_cambia_nada() -> None:
    gateway = _gateway()
    client = _client(gateway)
    items = [_item(_token().token) for _ in range(3)]
    assert _statuses(_sync(client, items)) == ["accepted"] * 3
    before = (dict(gateway.attempts), gateway.progress[PERFIL][TOPIC])
    assert _statuses(_sync(client, items)) == ["duplicate"] * 3
    assert (dict(gateway.attempts), gateway.progress[PERFIL][TOPIC]) == before


def test_envios_simultaneos_del_mismo_lote_no_duplican() -> None:
    gateway = _gateway()
    app = _client(gateway).app
    items = [_item(_token().token) for _ in range(5)]

    async def both() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            send = lambda: _sync(c, items)  # noqa: E731
            return await asyncio.gather(send(), send())

    first, second = asyncio.run(both())
    statuses = sorted(r["status"] for resp in (first, second) for r in resp.json()["results"])
    assert statuses == ["accepted"] * 5 + ["duplicate"] * 5
    assert len(gateway.attempts) == 5
    assert gateway.progress[PERFIL][TOPIC].block_total == 5


def test_un_token_de_practica_en_linea_no_entra_como_sin_conexion() -> None:
    gateway = _gateway()
    online = issue(KEY, PERFIL, TOPIC, 600)
    assert online is not None
    item = _item(_token().token)
    item["token"] = online.token
    assert _statuses(_sync(_client(gateway), [item])) == ["rejected"]
    assert gateway.attempts == {}


def test_un_token_del_lote_ya_respondido_es_duplicado() -> None:
    gateway = _gateway()
    made = _token()
    # Mismo jti ya registrado (como si se hubiera respondido antes por otra vía).
    asyncio.run(
        gateway.record_attempt(TUTOR, PERFIL, made.exercise_id, TOPIC, "x", True, None, 1, None)
    )
    assert _statuses(_sync(_client(gateway), [_item(made.token)])) == ["duplicate"]


# ---- Lote parcial, tokens y margen ----------------------------------------------------------


def test_lote_parcial_los_validos_entran_y_los_invalidos_se_rechazan() -> None:
    gateway = _gateway()
    good = _item(_token().token)
    bad = _item(_token().token)
    bad["token"] = bad["token"][:-4] + "AAAA"
    other = _item(_token().token)
    other["token"] = _token(student=OTRO_PERFIL).token
    shape = _item(_token().token, answer_den=3)
    assert _statuses(_sync(_client(gateway), [good, bad, other, shape])) == [
        "accepted",
        "rejected",
        "rejected",
        "rejected",
    ]
    assert len(gateway.attempts) == 1


def test_margen_de_14_dias_tras_la_caducidad() -> None:
    gateway = _gateway()
    vencido_hace_13 = _token(issued=time.time() - WEEK - 13 * DAY)
    vencido_hace_15 = _token(issued=time.time() - WEEK - 15 * DAY)
    items = [
        _item(vencido_hace_13.token) | {"answer": 0},
        _item(vencido_hace_13.token) | {"answer": 0},
    ]
    items[1]["token"] = vencido_hace_15.token
    assert _statuses(_sync(_client(gateway), items)) == ["accepted", "rejected"]


def test_el_margen_solo_existe_para_tokens_del_lote() -> None:
    online = issue(KEY, PERFIL, TOPIC, 600, now=time.time() - 700)
    assert online is not None
    with pytest.raises(InvalidExercise):
        verify(KEY, online.token, PERFIL, grace_s=GRACE)
    with pytest.raises(InvalidExercise):
        verify(KEY, online.token, PERFIL, diagnostic=True, grace_s=GRACE)
    with pytest.raises(InvalidExercise):
        verify(KEY, _token().token, PERFIL, offline=True, grace_s=-1)


# ---- Acceso, perfil y límites ---------------------------------------------------------------


def test_sin_jwt_401() -> None:
    response = _client(_gateway()).post(
        f"/v1/students/{PERFIL}/offline-sync", json={"attempts": []}
    )
    assert response.status_code == 401


def test_perfil_de_otro_tutor_403_sin_registrar_nada() -> None:
    gateway = _gateway()
    response = _sync(_client(gateway), [_item(_token().token)], student=OTRO_PERFIL, sub=TUTOR)
    assert response.status_code == 403
    assert gateway.attempts == {}


@pytest.mark.parametrize("outcome", ["student_blocked", "consent_required"])
def test_perfil_bloqueado_o_sin_consentimiento_403_sin_afectar_a_otros(outcome: str) -> None:
    gateway = _gateway()
    gateway.outcomes[(TUTOR, PERFIL)] = outcome
    client = _client(gateway)
    assert _sync(client, [_item(_token().token)]).status_code == 403
    # Otro perfil (de otro tutor) se sincroniza igual: un endpoint por perfil.
    other_token = _token(student=OTRO_PERFIL).token
    other = _item(_token().token) | {
        "token": other_token,
        "answer": _answer(other_token, student=OTRO_PERFIL),
    }
    response = _sync(client, [other], student=OTRO_PERFIL, sub=OTRO_TUTOR)
    assert _statuses(response) == ["accepted"]


def test_perfil_borrado_a_mitad_403() -> None:
    gateway = _gateway()
    del gateway.grades[(TUTOR, PERFIL)]
    assert _sync(_client(gateway), [_item(_token().token)]).status_code == 403


def test_mas_de_15_intentos_por_lote_422() -> None:
    made = _token()
    items = [_item(made.token) for _ in range(16)]
    assert _sync(_client(_gateway()), items).status_code == 422


def test_falla_de_la_base_503_y_no_se_confirma_nada() -> None:
    gateway = _gateway()
    gateway.offline_sync_error = GatewayError("transport")
    assert _sync(_client(gateway), [_item(_token().token)]).status_code == 503
    assert gateway.attempts == {}


def test_una_sola_llamada_a_la_base_por_lote() -> None:
    gateway = _gateway()
    _sync(_client(gateway), [_item(_token().token) for _ in range(4)])
    assert len(gateway.offline_sync_calls) == 1


# ---- Logs sin datos del niño ----------------------------------------------------------------


def test_logs_solo_codigos(caplog: pytest.LogCaptureFixture) -> None:
    gateway = _gateway()
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logging.getLogger("mathtutor.offline").addHandler(handler)
    try:
        bad = _item(_token().token)
        bad["token"] = bad["token"][:-4] + "AAAA"
        _sync(_client(gateway), [_item(_token().token), bad])
    finally:
        logging.getLogger("mathtutor.offline").removeHandler(handler)
    text = stream.getvalue() + caplog.text
    assert "offline_sync.rejected" in text
    assert str(PERFIL) not in text
    # Ni el token, ni la respuesta, ni el id del dispositivo.
    assert bad["token"][:24] not in text
    assert bad["id"] not in text
    assert json.dumps([r.__dict__.get("fields") for r in caplog.records])


def test_fecha_local_de_hoy_es_aceptada() -> None:
    gateway = _gateway()
    _sync(_client(gateway), [_item(_token().token, local_date=date.today().isoformat())])
    assert gateway.streaks[PERFIL].current_len == 1
