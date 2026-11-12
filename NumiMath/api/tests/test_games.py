"""CU-A21, parte 1: juegos de refuerzo (opción y orden) para 1° y 2° básico."""

from __future__ import annotations

import base64
import json
import time
import uuid
from datetime import date
from typing import Any

import httpx
import pytest
import respx

from app.config import Settings
from app.db.gateway import GatewayError
from app.db.supabase_gateway import SupabaseGateway
from app.exercises.games import GAME_MESSAGES, GAMES
from app.exercises.levels import SkillProgress
from app.exercises.tokens import InvalidExercise, issue, issue_game, verify_game
from tests.test_offline_batch import KEY, PERFIL, TUTOR, URL, _client, _gateway, _jwt

CHOICE = "mayor-1"
ORDER = "ordena-1"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_jwt()}"}


def _new(client: Any, game_id: str, student: uuid.UUID = PERFIL) -> Any:
    return client.post(f"/v1/students/{student}/games/{game_id}/exercise", headers=_headers())


def _answer(client: Any, token: str, answer: list[str], **extra: Any) -> Any:
    return client.post(
        f"/v1/students/{PERFIL}/games/answer",
        headers=_headers(),
        json={"token": token, "answer": answer, **extra},
    )


def _solution(token: str) -> list[str]:
    return list(verify_game(KEY, token, PERFIL).exercise.solution)


def _wrong(token: str) -> list[str]:
    exercise = verify_game(KEY, token, PERFIL).exercise
    ids = [o.id for o in exercise.options]
    if exercise.kind == "choice":
        return [next(i for i in ids if i not in exercise.solution)]
    return list(reversed(exercise.solution))


# ---- Catálogo y cursos ------------------------------------------------------------------------


def test_lista_los_juegos_de_1_por_eje() -> None:
    body = _client(_gateway(grade=1)).get(f"/v1/students/{PERFIL}/games", headers=_headers()).json()
    assert body["grade"] == 1
    modules = {g["module"]: [x["id"] for x in g["games"]] for g in body["groups"]}
    assert set(modules) == {"Números y operaciones", "Patrones y álgebra"}
    assert "ordena-1" in modules["Números y operaciones"]
    assert all(GAMES[i].grade == 1 for ids in modules.values() for i in ids)


def test_lista_los_juegos_de_2() -> None:
    body = _client(_gateway(grade=2)).get(f"/v1/students/{PERFIL}/games", headers=_headers()).json()
    ids = [x["id"] for g in body["groups"] for x in g["games"]]
    assert ids and all(GAMES[i].grade == 2 for i in ids)


@pytest.mark.parametrize("grade", [3, 4])
def test_curso_no_permitido_403(grade: int) -> None:
    client = _client(_gateway(grade=grade))
    response = client.get(f"/v1/students/{PERFIL}/games", headers=_headers())
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "game_grade_not_allowed"
    assert _new(client, "mayor-2").status_code == 403


@pytest.mark.parametrize("outcome", ["student_blocked", "consent_required"])
def test_perfil_en_pausa_o_sin_consentimiento_no_juega(outcome: str) -> None:
    gateway = _gateway()
    gateway.outcomes[(TUTOR, PERFIL)] = outcome
    assert _new(_client(gateway), CHOICE).status_code == 403


def test_juego_de_otro_curso_o_inexistente_404() -> None:
    client = _client(_gateway(grade=1))
    assert _new(client, "mayor-2").status_code == 404
    assert _new(client, "no-existe").status_code == 404


# ---- Ejercicio: lo correcto no viaja ----------------------------------------------------------


@pytest.mark.parametrize("game_id", [CHOICE, ORDER])
def test_el_ejercicio_no_revela_la_solucion(game_id: str) -> None:
    body = _new(_client(_gateway()), game_id).json()
    assert set(body) == {"token", "game_id", "kind", "text", "options"}
    assert body["kind"] == GAMES[game_id].kind
    assert all(set(o) == {"id", "kind", "label"} for o in body["options"])
    payload = json.loads(base64.urlsafe_b64decode(body["token"].split(".")[0] + "=="))
    assert set(payload) == {"v", "j", "s", "g", "t", "k", "o", "i", "e"}
    # En el orden, las tarjetas llegan desordenadas: el token no deja leer la solución.
    if game_id == ORDER:
        assert payload["o"] != _solution(body["token"])


def test_opciones_con_tipo_estable() -> None:
    body = _new(_client(_gateway()), "donde-hay-mas-1").json()
    assert all(o["kind"] == "emoji" and o["id"].startswith("e:") for o in body["options"])


# ---- Respuesta: por tipo ----------------------------------------------------------------------


@pytest.mark.parametrize("game_id", [CHOICE, ORDER])
def test_respuesta_correcta(game_id: str) -> None:
    client = _client(_gateway())
    token = _new(client, game_id).json()["token"]
    body = _answer(client, token, _solution(token)).json()
    assert body == {
        "correct": True,
        "correct_answer": _solution(token),
        "message": GAME_MESSAGES["correct"],
    }


@pytest.mark.parametrize("game_id", [CHOICE, ORDER])
def test_respuesta_incorrecta_sin_culpa_y_con_la_correcta(game_id: str) -> None:
    client = _client(_gateway())
    token = _new(client, game_id).json()["token"]
    body = _answer(client, token, _wrong(token)).json()
    assert body["correct"] is False
    assert body["correct_answer"] == _solution(token)
    assert body["message"].startswith("Casi.")
    assert not any(w in body["message"].lower() for w in ("mal", "incorrect", "error"))


@pytest.mark.parametrize("game_id", [CHOICE, ORDER])
def test_respuesta_repetida_409(game_id: str) -> None:
    client = _client(_gateway())
    token = _new(client, game_id).json()["token"]
    assert _answer(client, token, _solution(token)).status_code == 200
    response = _answer(client, token, _solution(token))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "already_answered"


@pytest.mark.parametrize("game_id", [CHOICE, ORDER])
def test_ejercicio_vencido_422(game_id: str) -> None:
    issued = issue_game(KEY, PERFIL, GAMES[game_id], 600, now=time.time() - 601)
    response = _answer(_client(_gateway()), issued.token, list(issued.exercise.solution))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "exercise_invalid"


@pytest.mark.parametrize("game_id", [CHOICE, ORDER])
def test_firma_alterada_422(game_id: str) -> None:
    client = _client(_gateway())
    token = _new(client, game_id).json()["token"]
    payload_b64, signature = token.split(".")
    tampered = f"{payload_b64}.{signature[:-4]}AAAA"
    assert _answer(client, tampered, _solution(token)).status_code == 422


def test_cambiar_las_opciones_del_token_invalida_la_firma() -> None:
    client = _client(_gateway())
    token = _new(client, CHOICE).json()["token"]
    payload_b64, signature = token.split(".")
    payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=="))
    payload["o"] = ["n:1", "n:2", "n:3"]
    forged = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    assert _answer(client, f"{forged}.{signature}", ["n:3"]).status_code == 422


def test_un_token_de_practica_no_sirve_como_juego_ni_al_reves() -> None:
    practice = issue(KEY, PERFIL, "1-03", 600)
    assert practice is not None
    with pytest.raises(InvalidExercise):
        verify_game(KEY, practice.token, PERFIL)
    client = _client(_gateway())
    assert _answer(client, practice.token, ["n:1"]).status_code == 422
    game_token = _new(client, CHOICE).json()["token"]
    response = client.post(
        f"/v1/students/{PERFIL}/exercises/answer",
        headers=_headers(),
        json={"token": game_token, "answer": 1},
    )
    assert response.status_code == 422


def test_token_de_otro_perfil_no_sirve() -> None:
    other = uuid.UUID("99999999-0000-0000-0000-000000000009")
    issued = issue_game(KEY, other, GAMES[CHOICE], 600)
    assert (
        _answer(_client(_gateway()), issued.token, list(issued.exercise.solution)).status_code
        == 422
    )


@pytest.mark.parametrize(
    ("game_id", "make_answer"),
    [
        (CHOICE, lambda ids, sol: ["n:999"]),  # no está entre las opciones
        (CHOICE, lambda ids, sol: ids[:2]),  # dos opciones a la vez
        (ORDER, lambda ids, sol: list(sol)[:-1]),  # falta una tarjeta
        (ORDER, lambda ids, sol: [*list(sol)[:-1], list(sol)[0]]),  # una repetida
    ],
)
def test_respuesta_con_forma_invalida_422(game_id: str, make_answer: Any) -> None:
    client = _client(_gateway())
    token = _new(client, game_id).json()["token"]
    exercise = verify_game(KEY, token, PERFIL).exercise
    answer = make_answer([o.id for o in exercise.options], exercise.solution)
    assert _answer(client, token, answer).status_code == 422


# ---- Registro del intento, racha y bloque -----------------------------------------------------


def test_el_intento_queda_como_game_con_su_juego() -> None:
    gateway = _gateway()
    client = _client(gateway)
    token = _new(client, ORDER).json()["token"]
    _answer(client, token, _solution(token))
    ((key, (activity, game_kind)),) = gateway.activities.items()
    assert (activity, game_kind) == ("game", ORDER)
    assert gateway.attempts[key][0] == GAMES[ORDER].skill


def test_el_juego_suma_a_la_racha_pero_no_al_bloque_ni_al_nivel() -> None:
    gateway = _gateway()
    gateway.progress[PERFIL] = {"1-03": SkillProgress(level=1, block_total=9, block_correct=9)}
    client = _client(gateway)
    for _ in range(3):
        token = _new(client, CHOICE).json()["token"]
        _answer(client, token, _solution(token), local_date=date.today().isoformat())
    # 9/9 en el bloque: un acierto de práctica subiría de nivel; los juegos no lo tocan.
    assert gateway.progress[PERFIL]["1-03"] == SkillProgress(
        level=1, block_total=9, block_correct=9
    )
    assert gateway.streaks[PERFIL].current_len == 1


def test_falla_de_la_base_503() -> None:
    gateway = _gateway()
    gateway.record_error = GatewayError("transport")
    client = _client(gateway)
    token = _new(client, CHOICE).json()["token"]
    assert _answer(client, token, _solution(token)).status_code == 503


# ---- Gateway: solo los juegos mandan los parámetros nuevos ------------------------------------

RPC = f"{URL}/rest/v1/rpc/record_attempt"


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
async def test_gateway_juego_manda_activity_y_game_kind() -> None:
    route = respx.post(RPC).mock(return_value=httpx.Response(200, json="ok"))
    await _supabase().record_attempt(
        TUTOR,
        PERFIL,
        uuid.uuid4(),
        "1-03",
        "x",
        True,
        None,
        1,
        5,
        activity="game",
        game_kind="mayor-1",
    )
    body = json.loads(route.calls.last.request.content)
    assert (body["p_activity"], body["p_game_kind"]) == ("game", "mayor-1")


@respx.mock
async def test_gateway_practica_no_cambia_su_llamada() -> None:
    route = respx.post(RPC).mock(return_value=httpx.Response(200, json="ok"))
    await _supabase().record_attempt(TUTOR, PERFIL, uuid.uuid4(), "1-03", "x", True)
    body = json.loads(route.calls.last.request.content)
    assert "p_activity" not in body and "p_game_kind" not in body
