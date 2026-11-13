"""Diagnóstico inicial (CU-A2): regla del nivel, tokens propios, envío al final y que no cuente
para la práctica."""

from __future__ import annotations

import io
import itertools
import time
import uuid
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import GatewayError
from app.exercises.diagnostic import STEPS, entry_level, level_for_step
from app.exercises.levels import SkillProgress
from app.exercises.tokens import InvalidExercise, issue, verify
from app.main import create_app
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
SIGN = "clave-de-firma-de-ejercicios-solo-pruebas"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO_TUTOR = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
OTRO_PERFIL = uuid.UUID("22222222-bbbb-0000-0000-000000000002")
KEY = SIGN.encode()
TOPIC = "1-08"


def _jwt(sub: uuid.UUID = TUTOR) -> str:
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _gateway() -> FakeGateway:
    return FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok", (OTRO_TUTOR, OTRO_PERFIL): "ok"},
        grades={(TUTOR, PERFIL): 1, (OTRO_TUTOR, OTRO_PERFIL): 1},
    )


def _client(gateway: FakeGateway, ttl: int = 600) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=SIGN,
        exercise_token_ttl_seconds=ttl,
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _post(client: TestClient, path: str, body: dict[str, Any], sub: uuid.UUID = TUTOR) -> Any:
    return client.post(path, json=body, headers={"Authorization": f"Bearer {_jwt(sub)}"})


def _exercise(client: TestClient, step: int, topic: str = TOPIC) -> Any:
    return _post(
        client, f"/v1/students/{PERFIL}/diagnostic/exercises", {"topic": topic, "step": step}
    )


def _answer(token: str, right: bool) -> dict[str, Any]:
    solution = verify(KEY, token, PERFIL, diagnostic=True).exercise.answer
    return {"token": token, "answer": solution if right else solution + 1}


def _tokens(client: TestClient, topic: str = TOPIC) -> list[str]:
    tokens = []
    for step in range(STEPS):
        response = _exercise(client, step, topic)
        assert response.status_code == 200, response.text
        tokens.append(response.json()["token"])
    return tokens


def _submit(client: TestClient, answers: list[dict[str, Any]], topic: str = TOPIC) -> Any:
    return _post(client, f"/v1/students/{PERFIL}/diagnostic", {"topic": topic, "answers": answers})


# ---- regla del nivel -----------------------------------------------------------------------


def test_cada_paso_tiene_su_nivel() -> None:
    assert [level_for_step(s) for s in range(STEPS)] == [1, 1, 2, 2, 3, 3]
    with pytest.raises(ValueError):
        level_for_step(6)


@pytest.mark.parametrize(
    ("aciertos", "nivel"),
    [
        ([True] * 6, 3),  # acierta todo: tope 3
        ([True, True, True, True, False, True], 2),  # niveles 1 y 2 completos, falla el 3
        ([True, True, False, True, True, True], 3),  # regla literal: el MÁS ALTO con 2 de 2
        ([True, True, False, False, False, False], 1),
        ([False, True, True, False, True, False], 1),  # ningún nivel completo: mínimo 1
        ([False] * 6, 1),
    ],
)
def test_nivel_de_entrada(aciertos: list[bool], nivel: int) -> None:
    assert entry_level(aciertos) == nivel


def test_ninguna_combinacion_sale_del_rango_1_a_3() -> None:
    for combo in itertools.product([True, False], repeat=STEPS):
        assert 1 <= entry_level(list(combo)) <= 3


# ---- tokens -------------------------------------------------------------------------------


def test_un_token_de_practica_no_sirve_en_el_diagnostico_ni_al_reves() -> None:
    practica = issue(KEY, PERFIL, TOPIC, 600, level=1)
    diagnostico = issue(KEY, PERFIL, TOPIC, 600, level=1, step=0)
    assert practica is not None and diagnostico is not None
    with pytest.raises(InvalidExercise):
        verify(KEY, practica.token, PERFIL, diagnostic=True)
    with pytest.raises(InvalidExercise):
        verify(KEY, diagnostico.token, PERFIL)
    assert verify(KEY, diagnostico.token, PERFIL, diagnostic=True).step == 0


def test_la_practica_rechaza_un_token_del_diagnostico() -> None:
    client = _client(_gateway())
    token = _exercise(client, 0).json()["token"]
    response = _post(
        client, f"/v1/students/{PERFIL}/exercises/answer", {"token": token, "answer": 1}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "exercise_invalid"


# ---- pedir ejercicios ------------------------------------------------------------------------


def test_el_nivel_lo_fija_el_servidor_segun_el_paso() -> None:
    client = _client(_gateway())
    for step in range(STEPS):
        body = _exercise(client, step).json()
        assert body["level"] == level_for_step(step)
        assert body["step"] == step and body["steps"] == STEPS
        assert body["expires_in"] == 600
        assert "answer" not in body


@pytest.mark.parametrize("step", [-1, 6])
def test_paso_fuera_de_rango(step: int) -> None:
    assert _exercise(_client(_gateway()), step).status_code == 422


def test_habilidad_de_otro_curso() -> None:
    assert _exercise(_client(_gateway()), 0, topic="4-01").status_code == 422


def test_no_hay_diagnostico_si_la_habilidad_ya_tiene_progreso() -> None:
    gateway = _gateway()
    gateway.progress[PERFIL] = {TOPIC: SkillProgress(1, 3, 2)}
    response = _exercise(_client(gateway), 0)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "diagnostic_not_available"


def test_sin_poder_leer_el_progreso_no_se_ofrece() -> None:
    gateway = _gateway()
    gateway.levels_error = GatewayError("transport")
    assert _exercise(_client(gateway), 0).status_code == 503


def test_perfil_ajeno() -> None:
    client = _client(_gateway())
    response = _post(
        client,
        f"/v1/students/{PERFIL}/diagnostic/exercises",
        {"topic": TOPIC, "step": 0},
        sub=OTRO_TUTOR,
    )
    assert response.status_code == 403


# ---- enviar la prueba ------------------------------------------------------------------------


def test_envio_completo_guarda_el_nivel_y_los_6_intentos() -> None:
    gateway = _gateway()
    client = _client(gateway)
    tokens = _tokens(client)
    aciertos = [True, True, True, True, False, False]
    response = _submit(client, [_answer(t, ok) for t, ok in zip(tokens, aciertos, strict=True)])
    assert response.status_code == 200, response.text
    assert response.json() == {"level": 2}

    [(student, topic, level, items)] = gateway.diagnostics
    assert (student, topic, level) == (PERFIL, TOPIC, 2)
    assert [i.correct for i in items] == aciertos
    assert [i.level for i in items] == [1, 1, 2, 2, 3, 3]
    # Queda el nivel de entrada con el bloque vacío y sin dominar.
    assert gateway.progress[PERFIL][TOPIC] == SkillProgress(2, 0, 0, False)
    # No cuenta como práctica: ni intentos, ni racha.
    assert gateway.exercises == [] and gateway.streaks == {}
    assert gateway.touches == [(TUTOR, PERFIL)]


def test_el_orden_de_envio_no_importa() -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = [_answer(t, True) for t in _tokens(client)]
    assert _submit(client, list(reversed(answers))).json() == {"level": 3}


def test_despues_ya_no_se_ofrece() -> None:
    gateway = _gateway()
    client = _client(gateway)
    tokens = _tokens(client)
    assert _submit(client, [_answer(t, True) for t in tokens]).status_code == 200
    topics = client.get(
        f"/v1/students/{PERFIL}/topics", headers={"Authorization": f"Bearer {_jwt()}"}
    ).json()
    assert next(t for t in topics if t["id"] == TOPIC)["diagnostic_available"] is False
    assert _exercise(client, 0).status_code == 409


def test_reenviar_la_misma_prueba_no_guarda_dos_veces() -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = [_answer(t, True) for t in _tokens(client)]
    assert _submit(client, answers).status_code == 200
    response = _submit(client, answers)
    assert response.status_code == 409
    assert len(gateway.diagnostics) == 1


def test_faltan_pasos() -> None:
    client = _client(_gateway())
    answers = [_answer(t, True) for t in _tokens(client)]
    assert _submit(client, answers[:5]).status_code == 422


def test_un_paso_repetido() -> None:
    gateway = _gateway()
    client = _client(gateway)
    tokens = _tokens(client)
    # Seis ejercicios, pero el paso 5 (nivel 3) se cambia por otro paso 4.
    otro = _exercise(client, 4).json()["token"]
    answers = [_answer(t, True) for t in [*tokens[:5], otro]]
    assert _submit(client, answers).status_code == 422
    assert gateway.diagnostics == []


def test_temas_mezclados() -> None:
    gateway = _gateway()
    client = _client(gateway)
    tokens = _tokens(client)
    otro = _exercise(client, 5, topic="1-06").json()["token"]
    answers = [_answer(t, True) for t in [*tokens[:5], otro]]
    assert _submit(client, answers).status_code == 422
    assert gateway.diagnostics == []


def test_token_alterado() -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = [_answer(t, True) for t in _tokens(client)]
    answers[0]["token"] = answers[0]["token"][:-2] + "xx"
    response = _submit(client, answers)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "exercise_invalid"
    assert gateway.diagnostics == []


def test_token_vencido_no_guarda_nada() -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = []
    for step in range(STEPS):
        issued = issue(
            KEY, PERFIL, TOPIC, 600, now=time.time() - 601, level=level_for_step(step), step=step
        )
        assert issued is not None
        answers.append({"token": issued.token, "answer": issued.exercise.answer})
    response = _submit(client, answers)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "exercise_invalid"
    assert gateway.diagnostics == [] and PERFIL not in gateway.progress


def test_tokens_de_otro_perfil() -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = []
    for step in range(STEPS):
        issued = issue(KEY, OTRO_PERFIL, TOPIC, 600, level=level_for_step(step), step=step)
        assert issued is not None
        answers.append({"token": issued.token, "answer": issued.exercise.answer})
    assert _submit(client, answers).status_code == 422


def test_si_ya_practico_entre_medio_no_se_guarda() -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = [_answer(t, True) for t in _tokens(client)]
    gateway.progress[PERFIL] = {TOPIC: SkillProgress(1, 1, 1)}
    response = _submit(client, answers)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "diagnostic_not_available"


def test_si_la_base_falla_no_dice_que_se_guardo() -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = [_answer(t, True) for t in _tokens(client)]
    gateway.diagnostic_error = GatewayError("transport")
    assert _submit(client, answers).status_code == 503


def test_fracciones_equivalentes_cuentan() -> None:
    gateway = _gateway()
    gateway.grades[(TUTOR, PERFIL)] = 4
    client = _client(gateway)
    answers = []
    for step in range(STEPS):
        token = _exercise(client, step, topic="4-10").json()["token"]
        exercise = verify(KEY, token, PERFIL, diagnostic=True).exercise
        assert exercise.answer_den is not None
        answers.append(
            {"token": token, "answer": exercise.answer * 2, "answer_den": exercise.answer_den * 2}
        )
    response = _submit(client, answers, topic="4-10")
    assert response.status_code == 200, response.text
    assert response.json() == {"level": 3}


# ---- no cuenta para la práctica ------------------------------------------------------------


def test_topics_indica_si_hay_diagnostico() -> None:
    gateway = _gateway()
    gateway.progress[PERFIL] = {"1-06": SkillProgress(2)}
    topics = (
        _client(gateway)
        .get(f"/v1/students/{PERFIL}/topics", headers={"Authorization": f"Bearer {_jwt()}"})
        .json()
    )
    by_id = {t["id"]: t for t in topics}
    assert by_id["1-06"]["diagnostic_available"] is False
    assert by_id[TOPIC]["diagnostic_available"] is True


def test_topics_sin_progreso_legible_no_ofrece_diagnostico() -> None:
    gateway = _gateway()
    gateway.levels_error = GatewayError("transport")
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/topics", headers={"Authorization": f"Bearer {_jwt()}"}
    )
    assert response.status_code == 200
    assert all(t["diagnostic_available"] is False for t in response.json())
    assert all(t["level"] == 1 for t in response.json())


def test_la_practica_sigue_en_el_nivel_diagnosticado() -> None:
    gateway = _gateway()
    client = _client(gateway)
    tokens = _tokens(client)
    aciertos = [True, True, True, True, False, True]
    _submit(client, [_answer(t, ok) for t, ok in zip(tokens, aciertos, strict=True)])
    body = _post(client, f"/v1/students/{PERFIL}/exercises", {"topic": TOPIC}).json()
    assert body["level"] == 2
    assert body["block_done"] == 0


def test_los_logs_no_llevan_enunciados_ni_respuestas(log_stream: io.StringIO) -> None:
    gateway = _gateway()
    client = _client(gateway)
    answers = [_answer(t, True) for t in _tokens(client)]
    assert _submit(client, answers).status_code == 200
    logs = log_stream.getvalue()
    assert "diagnostic.saved" in logs
    for _, _, _, items in gateway.diagnostics:
        for item in items:
            assert item.exercise not in logs
    for answer in answers:
        assert answer["token"] not in logs
    assert str(PERFIL) not in logs


# ---- Rechazar el test inicial: nunca más para ese perfil y tema -------------------------------


def _topics(client: TestClient) -> dict[str, bool]:
    body = client.get(
        f"/v1/students/{PERFIL}/topics", headers={"Authorization": f"Bearer {_jwt()}"}
    ).json()
    return {t["id"]: t["diagnostic_available"] for t in body}


def _decline(client: TestClient, topic: str = TOPIC, sub: uuid.UUID = TUTOR) -> Any:
    return _post(client, f"/v1/students/{PERFIL}/diagnostic/{topic}/decline", {}, sub)


def test_rechazar_el_test_no_lo_vuelve_a_ofrecer_en_ese_tema() -> None:
    client = _client(_gateway())
    assert _topics(client)[TOPIC] is True
    response = _decline(client)
    assert response.status_code == 200 and response.json() == {"declined": True}
    topics = _topics(client)
    assert topics[TOPIC] is False
    assert any(topics.values())  # los otros temas siguen ofreciéndolo
    # Y tampoco se puede pedir un ejercicio del test de ese tema.
    assert _exercise(client, 0).status_code == 409


def test_rechazar_dos_veces_no_es_error() -> None:
    client = _client(_gateway())
    assert _decline(client).status_code == 200
    assert _decline(client).status_code == 200


def test_si_falla_al_guardar_el_rechazo_responde_503_y_no_lo_da_por_hecho() -> None:
    gateway = _gateway()
    gateway.declines_error = GatewayError("transport")
    client = _client(gateway)
    assert _decline(client).status_code == 503
    gateway.declines_error = None
    assert _topics(client)[TOPIC] is True  # se ofrecerá otra vez más tarde, como hoy


def test_sin_poder_leer_los_rechazos_no_se_ofrece_el_test() -> None:
    gateway = _gateway()
    gateway.declines_error = GatewayError("transport")
    assert not any(_topics(_client(gateway)).values())


def test_otro_tutor_no_rechaza_por_un_perfil_ajeno() -> None:
    gateway = _gateway()
    response = _decline(_client(gateway), sub=OTRO_TUTOR)
    assert response.status_code == 403
    assert gateway.declines == {}  # y no se guardó nada


def test_un_tema_que_no_es_del_curso_no_se_rechaza() -> None:
    gateway = _gateway()
    response = _decline(_client(gateway), topic="4-01")
    assert response.status_code == 422
    assert gateway.declines == {}
