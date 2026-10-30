"""Ejercicios: generación, firma, caducidad, perfil ajeno y una sola respuesta por ejercicio."""

from __future__ import annotations

import base64
import json
import math
import random
import time
import uuid
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.ai.topics import topics_for_grade
from app.config import Settings
from app.db.gateway import GatewayError
from app.exercises.generators import GENERATORS, generate
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


def _client(gateway: FakeGateway, signing: str = SIGN, ttl: int = 600) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=signing,
        exercise_token_ttl_seconds=ttl,
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _post(client: TestClient, path: str, body: dict[str, Any], sub: uuid.UUID = TUTOR) -> Any:
    return client.post(path, json=body, headers={"Authorization": f"Bearer {_jwt(sub)}"})


def _new(client: TestClient, topic: str = "1-08", student: uuid.UUID = PERFIL) -> Any:
    return _post(client, f"/v1/students/{student}/exercises", {"topic": topic})


def _solve(token: str, student: uuid.UUID = PERFIL) -> int:
    return verify(KEY, token, student).exercise.answer


# ---- generadores -------------------------------------------------------------------------


def test_todos_los_temas_tienen_generador() -> None:
    ids = {t.id for curso in (1, 2, 3, 4) for t in topics_for_grade(curso)}
    assert ids == set(GENERATORS)


@pytest.mark.parametrize("level", [1, 2, 3])
@pytest.mark.parametrize("topic", sorted(GENERATORS))
def test_los_generadores_producen_enteros_no_negativos_y_son_deterministas(
    topic: str, level: int
) -> None:
    for seed in range(200):
        first = generate(topic, random.Random(seed), level)  # noqa: S311
        again = generate(topic, random.Random(seed), level)  # noqa: S311
        assert first is not None and first == again
        assert isinstance(first.answer, int) and 0 <= first.answer <= 1_000_000
        # Las fracciones (solo 4-10) tienen denominador válido y no son cero.
        if first.answer_den is not None:
            assert topic == "4-10"
            assert 1 <= first.answer_den <= 1000 and first.answer > 0
        # Cabe en la columna `exercise` de student_attempts.
        assert 1 <= len(first.text) <= 200


def test_un_nivel_fuera_de_rango_se_acota() -> None:
    assert generate("1-08", random.Random(1), 99) == generate(  # noqa: S311
        "1-08",
        random.Random(1),  # noqa: S311
        3,
    )


# ---- token -------------------------------------------------------------------------------


def test_el_token_no_lleva_la_respuesta_ni_la_semilla() -> None:
    issued = issue(KEY, PERFIL, "1-08", 600)
    assert issued is not None
    payload = issued.token.split(".")[0]
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert set(data) == {"v", "j", "s", "t", "l", "i", "e"}
    assert data["s"] == str(PERFIL)


@pytest.mark.parametrize("level", [1, 2, 3])
def test_el_token_lleva_el_nivel_firmado(level: int) -> None:
    issued = issue(KEY, PERFIL, "1-08", 600, level=level)
    assert issued is not None and issued.level == level
    verified = verify(KEY, issued.token, PERFIL)
    assert verified.level == level and verified.exercise == issued.exercise


def test_no_se_emite_un_nivel_que_no_existe() -> None:
    assert issue(KEY, PERFIL, "1-08", 600, level=0) is None
    assert issue(KEY, PERFIL, "1-08", 600, level=4) is None


def test_cambiar_el_nivel_del_token_rompe_la_firma() -> None:
    issued = issue(KEY, PERFIL, "1-08", 600, level=1)
    assert issued is not None
    payload, signature = issued.token.split(".")
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    data["l"] = 3
    forged = base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()
    with pytest.raises(InvalidExercise):
        verify(KEY, f"{forged}.{signature}", PERFIL)


def test_el_token_sirve_en_su_perfil() -> None:
    issued = issue(KEY, PERFIL, "1-08", 600)
    assert issued is not None
    assert verify(KEY, issued.token, PERFIL).exercise == issued.exercise


def test_el_token_no_sirve_en_otro_perfil() -> None:
    issued = issue(KEY, PERFIL, "1-08", 600)
    assert issued is not None
    with pytest.raises(InvalidExercise):
        verify(KEY, issued.token, OTRO_PERFIL)


def test_el_token_vencido_no_sirve() -> None:
    now = 1_000_000.0
    issued = issue(KEY, PERFIL, "1-08", 60, now=now)
    assert issued is not None
    assert verify(KEY, issued.token, PERFIL, now=now + 59).exercise == issued.exercise
    with pytest.raises(InvalidExercise):
        verify(KEY, issued.token, PERFIL, now=now + 60)


def test_un_token_alterado_o_con_otra_clave_no_sirve() -> None:
    issued = issue(KEY, PERFIL, "1-08", 600)
    assert issued is not None
    payload, signature = issued.token.split(".")
    with pytest.raises(InvalidExercise):
        verify(KEY, f"{payload[:-2]}AA.{signature}", PERFIL)
    with pytest.raises(InvalidExercise):
        verify(b"otra-clave", issued.token, PERFIL)
    for basura in ("", "x", "a.b", "a.b.c"):
        with pytest.raises(InvalidExercise):
            verify(KEY, basura, PERFIL)


# ---- rutas -------------------------------------------------------------------------------


def test_lista_los_temas_del_curso_del_perfil() -> None:
    client = _client(_gateway())
    response = client.get(
        f"/v1/students/{PERFIL}/topics", headers={"Authorization": f"Bearer {_jwt()}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert [t["id"] for t in body] == [t.id for t in topics_for_grade(1)]
    primera = body[0]
    assert primera["level"] == 1 and primera["block_done"] == 0 and primera["block_size"] == 10
    assert primera["mastered"] is False and primera["review"] is False
    assert primera["module"] == "Números y operaciones"


def test_un_perfil_de_3_ve_su_curso_y_el_repaso() -> None:
    gateway = _gateway()
    gateway.grades[(TUTOR, PERFIL)] = 3
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/topics", headers={"Authorization": f"Bearer {_jwt()}"}
    )
    body = response.json()
    propias = [t for t in body if not t["review"]]
    repaso = [t for t in body if t["review"]]
    assert propias and all(t["grade"] == 3 for t in propias)
    assert {t["grade"] for t in repaso} == {1, 2}
    assert body.index(propias[-1]) < body.index(repaso[0])  # primero su curso


def test_un_tema_de_otro_curso_se_rechaza() -> None:
    assert _new(_client(_gateway()), topic="3-09").status_code == 422


def test_un_perfil_ajeno_recibe_403() -> None:
    assert _new(_client(_gateway()), student=OTRO_PERFIL).status_code == 403


def test_responder_correcto_registra_y_devuelve_la_respuesta() -> None:
    gateway = _gateway()
    client = _client(gateway)
    exercise = _new(client).json()
    answer = _solve(exercise["token"])
    response = _post(
        client,
        f"/v1/students/{PERFIL}/exercises/answer",
        {"token": exercise["token"], "answer": answer},
    )
    assert response.status_code == 200
    assert response.json() == {
        "correct": True,
        "correct_answer": answer,
        "correct_answer_den": None,
        "simplified_num": None,
        "simplified_den": None,
    }
    assert len(gateway.attempts) == 1


def test_responder_mal_registra_el_intento_incorrecto() -> None:
    gateway = _gateway()
    client = _client(gateway)
    exercise = _new(client).json()
    answer = _solve(exercise["token"])
    response = _post(
        client,
        f"/v1/students/{PERFIL}/exercises/answer",
        {"token": exercise["token"], "answer": answer + 1},
    )
    assert response.json()["correct"] is False
    assert response.json()["correct_answer"] == answer
    assert [a[2] for a in gateway.attempts.values()] == [False]


def test_cada_ejercicio_se_responde_una_sola_vez() -> None:
    gateway = _gateway()
    client = _client(gateway)
    exercise = _new(client).json()
    answer = _solve(exercise["token"])
    body = {"token": exercise["token"], "answer": answer}
    path = f"/v1/students/{PERFIL}/exercises/answer"
    assert _post(client, path, body).status_code == 200
    again = _post(client, path, body)  # la misma respuesta, otra vez
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_answered"
    # Cambiar la respuesta tampoco sirve.
    assert _post(client, path, {**body, "answer": answer + 1}).status_code == 409
    assert len(gateway.attempts) == 1


def test_un_token_de_otro_perfil_no_sirve_en_la_ruta() -> None:
    gateway = _gateway()
    client = _client(gateway)
    ajeno = _new(client, student=PERFIL).json()  # emitido para PERFIL
    # El otro tutor lo usa en SU perfil: la firma lleva el id de PERFIL.
    response = _post(
        client,
        f"/v1/students/{OTRO_PERFIL}/exercises/answer",
        {"token": ajeno["token"], "answer": 1},
        sub=OTRO_TUTOR,
    )
    assert response.status_code == 422
    assert gateway.attempts == {}


def test_un_token_vencido_no_se_acepta_en_la_ruta(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(_gateway(), ttl=30)
    exercise = _new(client).json()
    real = time.time()
    monkeypatch.setattr("app.exercises.tokens.time.time", lambda: real + 31)
    response = _post(
        client,
        f"/v1/students/{PERFIL}/exercises/answer",
        {"token": exercise["token"], "answer": 1},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "exercise_invalid"


def test_sin_clave_de_firma_se_deniega() -> None:
    assert _new(_client(_gateway(), signing="")).status_code == 503


def test_si_la_base_falla_al_registrar_se_deniega() -> None:
    gateway = _gateway()
    client = _client(gateway)
    exercise = _new(client).json()
    gateway.record_error = GatewayError("transport")
    response = _post(
        client,
        f"/v1/students/{PERFIL}/exercises/answer",
        {"token": exercise["token"], "answer": 1},
    )
    assert response.status_code == 503


def test_la_respuesta_debe_ser_un_numero_entero() -> None:
    client = _client(_gateway())
    exercise = _new(client).json()
    for malo in ("hola", -1, 10**9, 3.5):
        response = _post(
            client,
            f"/v1/students/{PERFIL}/exercises/answer",
            {"token": exercise["token"], "answer": malo},
        )
        assert response.status_code == 422


# ---- dificultad progresiva en la ruta ----------------------------------------------------


def _answer(
    client: TestClient, exercise: dict[str, Any], correct: bool, topic: str = "1-08"
) -> None:
    del topic  # el token ya lleva la habilidad
    answer = _solve(exercise["token"])
    response = _post(
        client,
        f"/v1/students/{PERFIL}/exercises/answer",
        {"token": exercise["token"], "answer": answer if correct else answer + 1},
    )
    assert response.status_code == 200


def test_el_primer_ejercicio_es_nivel_1() -> None:
    exercise = _new(_client(_gateway())).json()
    assert exercise["level"] == 1
    assert exercise["block_done"] == 0 and exercise["block_size"] == 10
    assert exercise["answer_kind"] == "integer" and exercise["mastered"] is False


def _block(client: TestClient, right: int, topic: str = "1-08") -> list[int]:
    """Responde un bloque de 10 (`right` bien) y devuelve los niveles con que se emitieron."""
    levels = []
    for i in range(10):
        exercise = _new(client, topic=topic).json()
        assert exercise["block_done"] == i
        levels.append(exercise["level"])
        _answer(client, exercise, i < right, topic)
    return levels


def test_sube_con_8_de_10_y_baja_con_4_de_10() -> None:
    gateway = _gateway()
    client = _client(gateway)
    assert set(_block(client, 8)) == {1}
    assert set(_block(client, 7)) == {2}  # subió; 7 de 10 repite
    assert set(_block(client, 4)) == {2}
    assert _new(client).json()["level"] == 1  # 4 de 10 bajó
    # Cada intento se registró con el nivel con que se emitió.
    assert [lv for _, _, lv, _ in gateway.levels] == [1] * 10 + [2] * 20


def test_dominar_la_habilidad() -> None:
    client = _client(_gateway())
    for _ in range(3):
        _block(client, 10)
    exercise = _new(client).json()
    assert exercise["level"] == 3 and exercise["mastered"] is True
    topics = client.get(
        f"/v1/students/{PERFIL}/topics", headers={"Authorization": f"Bearer {_jwt()}"}
    ).json()
    assert next(t for t in topics if t["id"] == "1-08")["mastered"] is True


def test_el_nivel_es_por_habilidad() -> None:
    client = _client(_gateway())
    _block(client, 10)
    assert _new(client).json()["level"] == 2
    assert _new(client, topic="1-09").json()["level"] == 1


def test_si_falla_la_lectura_del_nivel_se_usa_el_1() -> None:
    gateway = _gateway()
    client = _client(gateway)
    _block(client, 10)
    gateway.levels_error = GatewayError("transport")
    response = _new(client)
    assert response.status_code == 200
    assert response.json()["level"] == 1


def test_no_repite_enunciados_dentro_del_bloque() -> None:
    client = _client(_gateway())
    textos = []
    for _ in range(10):
        exercise = _new(client, topic="1-06").json()
        textos.append(exercise["text"])
        _answer(client, exercise, True, "1-06")
    assert len(set(textos)) == 10


def test_si_hay_pocos_enunciados_se_acepta_repetir() -> None:
    # Tabla del 2, nivel 1: 2 × 1 a 2 × 5 (en ambos órdenes) son menos de 10 enunciados.
    gateway = _gateway()
    gateway.grades[(TUTOR, PERFIL)] = 2
    client = _client(gateway)
    textos = []
    for _ in range(10):
        exercise = _new(client, topic="2-12")
        assert exercise.status_code == 200
        textos.append(exercise.json()["text"])
        _answer(client, exercise.json(), True, "2-12")
    assert len(set(textos)) < 10  # repitió, pero no se trabó


# ---- fracciones (4-10) -------------------------------------------------------------------


def _fraction_client() -> TestClient:
    gateway = _gateway()
    gateway.grades[(TUTOR, PERFIL)] = 4
    return _client(gateway)


def _send(client: TestClient, token: str, body: dict[str, Any]) -> Any:
    return _post(client, f"/v1/students/{PERFIL}/exercises/answer", {"token": token, **body})


def test_un_ejercicio_de_fracciones_pide_numerador_y_denominador() -> None:
    client = _fraction_client()
    exercise = _new(client, topic="4-10").json()
    assert exercise["answer_kind"] == "fraction"
    real = verify(KEY, exercise["token"], PERFIL).exercise
    response = _send(
        client, exercise["token"], {"answer": real.answer, "answer_den": real.answer_den}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["correct"] is True
    assert (body["correct_answer"], body["correct_answer_den"]) == (real.answer, real.answer_den)


def test_una_fraccion_equivalente_es_correcta_y_se_muestra_simplificada() -> None:
    client = _fraction_client()
    exercise = _new(client, topic="4-10").json()
    real = verify(KEY, exercise["token"], PERFIL).exercise
    assert real.answer_den is not None
    response = _send(
        client, exercise["token"], {"answer": 3 * real.answer, "answer_den": 3 * real.answer_den}
    )
    body = response.json()
    assert body["correct"] is True
    common = math.gcd(real.answer, real.answer_den)
    assert (body["simplified_num"], body["simplified_den"]) == (
        real.answer // common,
        real.answer_den // common,
    )


def test_una_fraccion_distinta_es_incorrecta() -> None:
    client = _fraction_client()
    exercise = _new(client, topic="4-10").json()
    real = verify(KEY, exercise["token"], PERFIL).exercise
    assert real.answer_den is not None
    response = _send(
        client, exercise["token"], {"answer": real.answer + 1, "answer_den": real.answer_den}
    )
    assert response.json()["correct"] is False
    assert response.json()["simplified_num"] is None


@pytest.mark.parametrize("cuerpo", [{"answer": 3}, {"answer": 3, "answer_den": 0}])
def test_una_fraccion_sin_denominador_o_con_cero_se_rechaza(cuerpo: dict[str, Any]) -> None:
    client = _fraction_client()
    exercise = _new(client, topic="4-10").json()
    assert _send(client, exercise["token"], cuerpo).status_code == 422


def test_un_denominador_en_un_ejercicio_de_enteros_se_rechaza() -> None:
    client = _client(_gateway())
    exercise = _new(client).json()
    answer = _solve(exercise["token"])
    response = _send(client, exercise["token"], {"answer": answer, "answer_den": 1})
    assert response.status_code == 422


def test_responder_guarda_el_tiempo_medido_por_el_servidor(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = _gateway()
    client = _client(gateway)
    exercise = _new(client).json()
    answer = _solve(exercise["token"])
    real = time.time()
    monkeypatch.setattr("app.exercises.tickets.time.time", lambda: real + 37)
    _post(
        client,
        f"/v1/students/{PERFIL}/exercises/answer",
        {"token": exercise["token"], "answer": answer},
    )
    assert gateway.durations and 36 <= (gateway.durations[-1] or 0) <= 38
