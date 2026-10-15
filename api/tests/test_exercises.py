"""Ejercicios: generación, firma, caducidad, perfil ajeno y una sola respuesta por ejercicio."""

from __future__ import annotations

import base64
import json
import random
import time
import uuid
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.ai.topics import TOPICS_BY_GRADE
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


def _new(client: TestClient, topic: str = "sumas_hasta_20", student: uuid.UUID = PERFIL) -> Any:
    return _post(client, f"/v1/students/{student}/exercises", {"topic": topic})


def _solve(token: str, student: uuid.UUID = PERFIL) -> int:
    return verify(KEY, token, student).exercise.answer


# ---- generadores -------------------------------------------------------------------------


def test_todos_los_temas_tienen_generador() -> None:
    ids = {t.id for topics in TOPICS_BY_GRADE.values() for t in topics}
    assert ids <= set(GENERATORS)


@pytest.mark.parametrize("topic", sorted(GENERATORS))
def test_los_generadores_producen_enteros_no_negativos_y_son_deterministas(topic: str) -> None:
    for seed in range(200):
        first = generate(topic, random.Random(seed))  # noqa: S311
        again = generate(topic, random.Random(seed))  # noqa: S311
        assert first is not None and first == again
        assert isinstance(first.answer, int) and first.answer >= 0
        assert first.text


# ---- token -------------------------------------------------------------------------------


def test_el_token_no_lleva_la_respuesta_ni_la_semilla() -> None:
    issued = issue(KEY, PERFIL, "sumas_hasta_20", 600)
    assert issued is not None
    payload = issued.token.split(".")[0]
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert set(data) == {"v", "j", "s", "t", "e"}
    assert data["s"] == str(PERFIL)


def test_el_token_sirve_en_su_perfil() -> None:
    issued = issue(KEY, PERFIL, "sumas_hasta_20", 600)
    assert issued is not None
    assert verify(KEY, issued.token, PERFIL).exercise == issued.exercise


def test_el_token_no_sirve_en_otro_perfil() -> None:
    issued = issue(KEY, PERFIL, "sumas_hasta_20", 600)
    assert issued is not None
    with pytest.raises(InvalidExercise):
        verify(KEY, issued.token, OTRO_PERFIL)


def test_el_token_vencido_no_sirve() -> None:
    now = 1_000_000.0
    issued = issue(KEY, PERFIL, "sumas_hasta_20", 60, now=now)
    assert issued is not None
    assert verify(KEY, issued.token, PERFIL, now=now + 59).exercise == issued.exercise
    with pytest.raises(InvalidExercise):
        verify(KEY, issued.token, PERFIL, now=now + 60)


def test_un_token_alterado_o_con_otra_clave_no_sirve() -> None:
    issued = issue(KEY, PERFIL, "sumas_hasta_20", 600)
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
    assert {t["id"] for t in response.json()} == {t.id for t in TOPICS_BY_GRADE[1]}


def test_un_tema_de_otro_curso_se_rechaza() -> None:
    assert _new(_client(_gateway()), topic="tablas_de_multiplicar").status_code == 422


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
    assert response.json() == {"correct": True, "correct_answer": answer}
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
    assert response.json() == {"correct": False, "correct_answer": answer}
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
