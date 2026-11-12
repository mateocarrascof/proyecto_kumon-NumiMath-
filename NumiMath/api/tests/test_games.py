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
from app.exercises.games import GAME_MESSAGES, GAMES, valid_answer
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
    assert set(body) == {"token", "game_id", "kind", "text", "options", "slots"}
    assert body["slots"] is None  # solo los juegos de completar traen lugares fijos
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


# ---- Correcciones de la revisión ----------------------------------------------------------------


@pytest.mark.parametrize("game_id", sorted(GAMES))
def test_cada_juego_cumple_sus_invariantes_con_muchas_semillas(game_id: str) -> None:
    """Protege los generadores: si alguien cambia un rango, falla aquí y no al emitir."""
    game = GAMES[game_id]
    for _ in range(500):
        issued = issue_game(KEY, PERFIL, game, 600)
        exercise = issued.exercise
        ids = [o.id for o in exercise.options]
        assert len(set(ids)) == len(ids)
        assert all(o.id.split(":")[0] in {"n", "e", "s", "f"} for o in exercise.options)
        if game.kind == "choice":
            assert 2 <= len(ids) <= 4
            assert len(exercise.solution) == 1 and exercise.solution[0] in ids
        elif game.kind == "order":
            assert 2 <= len(ids) <= 4
            assert sorted(exercise.solution) == sorted(ids) and tuple(ids) != exercise.solution
        else:  # fill: la solución completa cabe en las tarjetas y respeta las fijas
            assert exercise.slots is not None and len(exercise.slots) == len(exercise.solution)
            assert set(exercise.solution) <= set(ids)
            assert valid_answer(exercise, list(exercise.solution))
        assert verify_game(KEY, issued.token, PERFIL).exercise == exercise


def test_cada_juego_usa_una_habilidad_del_catalogo_con_su_curso() -> None:
    from app.ai.topics import topics_for_grade

    for game in GAMES.values():
        skills = {t.id: t for t in topics_for_grade(game.grade) if t.grade == game.grade}
        assert game.skill in skills, game.id
        assert skills[game.skill].module == game.module, game.id


def test_un_token_invalido_no_llega_a_la_base() -> None:
    gateway = _gateway()
    client = _client(gateway)
    before = len(gateway.calls)
    assert _answer(client, "a" * 20 + ".bbbb", ["n:1"]).status_code == 422
    # Solo la autorización del perfil (dependencia); ni el curso ni el registro.
    assert len(gateway.calls) == before + 1
    assert gateway.activities == {}


def test_un_juego_no_cuenta_como_practica_para_el_diagnostico() -> None:
    import asyncio

    gateway = _gateway()
    client = _client(gateway)
    token = _new(client, CHOICE).json()["token"]  # habilidad 1-03
    _answer(client, token, _solution(token))
    result = asyncio.run(gateway.save_diagnostic(TUTOR, PERFIL, "1-03", 1, []))
    assert result == "ok"


# ---- CU-A21, parte 3: juegos de 1° básico (tanda 1: temas 1 a 5) --------------------------------


def _many(game_id: str, n: int = 3000):
    for _ in range(n):
        yield issue_game(KEY, PERFIL, GAMES[game_id], 600).exercise


def _num(option_id: str) -> int:
    return int(option_id.split(":")[1])


def test_completa_el_camino_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("completa-camino-1"):
        values = [_num(i) for i in e.solution]
        step = values[1] - values[0]
        assert step in (1, 2, 5, 10)
        assert all(b - a == step for a, b in zip(values, values[1:], strict=False))
        assert values[0] >= 0 and values[-1] <= 100 and len(values) == 6
        assert e.slots is not None
        gaps = [i for i, s in enumerate(e.slots) if s is None]
        assert len(gaps) == 2 and e.slots[0] is not None and e.slots[1] is not None
        loose = {o.id for o in e.options} - {s for s in e.slots if s is not None}
        assert {e.solution[g] for g in gaps} < loose  # los que faltan, y además 2 que no van
        assert len(loose) == 4 and all(_num(i) not in values for i in loose - set(e.solution))


def test_descompone_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("descompone-1"):
        total, rest = e.text.split(" = ")
        have = int(rest.split(" + ")[0])
        assert 3 <= int(total) <= 10 and 1 <= have < int(total)
        assert _num(e.solution[0]) == int(total) - have


def test_junta_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("junta-1"):
        groups = e.text.rsplit("? ", 1)[1].split(" ")
        assert len(groups) == 2
        count = sum(len(g) // len(g[0]) for g in groups)  # mismo emoji repetido
        assert _num(e.solution[0]) == count <= 18


def _fill_token(client: Any) -> tuple[str, Any]:
    token = _new(client, "completa-camino-1").json()["token"]
    return token, verify_game(KEY, token, PERFIL).exercise


def test_completar_respuesta_correcta_e_incorrecta() -> None:
    client = _client(_gateway())
    token, e = _fill_token(client)
    body = _answer(client, token, list(e.solution)).json()
    assert body["correct"] is True
    token, e = _fill_token(client)
    gaps = [i for i, s in enumerate(e.slots) if s is None]
    wrong = list(e.solution)
    wrong[gaps[0]], wrong[gaps[1]] = wrong[gaps[1]], wrong[gaps[0]]  # huecos intercambiados
    body = _answer(client, token, wrong).json()
    assert body["correct"] is False
    assert body["message"] == GAME_MESSAGES["fill_wrong"]
    assert body["correct_answer"] == list(e.solution)


def test_completar_el_ejercicio_trae_los_lugares_fijos_sin_la_solucion() -> None:
    body = _new(_client(_gateway()), "completa-camino-1").json()
    assert body["kind"] == "fill"
    assert body["slots"].count(None) == 2
    e = verify_game(KEY, body["token"], PERFIL).exercise
    assert [s for s in body["slots"] if s is not None] == [s for s in e.slots if s is not None]


@pytest.mark.parametrize("break_it", ["mover", "faltar", "repetir", "ajena"])
def test_completar_rechaza_si_una_tarjeta_fija_se_mueve_o_falta(break_it: str) -> None:
    client = _client(_gateway())
    token, e = _fill_token(client)
    answer = list(e.solution)
    fixed_i = next(i for i, s in enumerate(e.slots) if s is not None)
    gap_i = next(i for i, s in enumerate(e.slots) if s is None)
    if break_it == "mover":
        answer[fixed_i], answer[gap_i] = answer[gap_i], answer[fixed_i]
    elif break_it == "faltar":
        answer = answer[:-1]
    elif break_it == "repetir":
        other = next(i for i, s in enumerate(e.slots) if s is None and i != gap_i)
        answer[other] = answer[gap_i]
    else:
        answer[gap_i] = "n:999"
    assert _answer(client, token, answer).status_code == 422
