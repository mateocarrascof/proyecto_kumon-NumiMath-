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
    # Los 10 temas de 1° (CU-A21 parte 3) se reparten en los 5 ejes del catálogo.
    assert set(modules) == {
        "Números y operaciones",
        "Patrones y álgebra",
        "Geometría",
        "Medición",
        "Datos y probabilidades",
    }
    assert "ordena-1" in modules["Números y operaciones"]
    assert all(GAMES[i].grade == 1 for ids in modules.values() for i in ids)
    # Cada juego dice su habilidad: 1-03 tiene tres juegos ("Aprender jugando" abre la lista).
    skills = {x["id"]: x["skill"] for g in body["groups"] for x in g["games"]}
    assert all(skills[i] == GAMES[i].skill for i in skills)
    assert sorted(i for i, s in skills.items() if s == "1-03") == [
        "donde-hay-mas-1",
        "mayor-1",
        "ordena-1",
    ]


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
    assert set(body) == {
        "token",
        "game_id",
        "kind",
        "text",
        "options",
        "slots",
        "pattern",
        "scene",
        "picto",
        "measure",
        "blocks",
    }
    # Solo completar trae lugares fijos, y solo los juegos de la parte 3 traen algo que dibujar.
    assert all(body[k] is None for k in ("slots", "pattern", "scene", "picto", "measure", "blocks"))
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
    # Del catálogo completo, no solo de las practicables (fase A): un juego no cambia el nivel,
    # así que puede usar una habilidad de fase B (figuras, posición, medición, pictogramas).
    from app.curriculum.catalog import get_skill

    for game in GAMES.values():
        skill = get_skill(game.skill)
        assert skill is not None, game.id
        assert (skill.grade, skill.module) == (game.grade, game.module), game.id


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


def _shape(option_id: str) -> str:
    return option_id.split(":")[1].split("-")[0]


def test_los_textos_concuerdan_con_un_objeto_masculino(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hoy todos los objetos son femeninos; si se agrega uno masculino, "Junta y cuenta" y el
    pictograma dicen "los" y "¿Cuántos…?"."""
    from app.exercises import games

    monkeypatch.setattr(games, "_MASCULINE_OBJECTS", frozenset(games._OBJECTS))
    for _ in range(50):
        assert "Junta los " in _many_one("junta-1").text
        text = _many_one("pictograma-1").text
        assert "¿Cuántos " in text and "¿Cuántas " not in text


def _many_one(game_id: str):
    return next(_many(game_id, 1))


def test_figura_que_sigue_es_valida_en_miles_de_ejercicios() -> None:
    for e in _many("figura-sigue-1"):
        assert e.pattern is not None
        ids = [o.id for o in e.options]
        # Se distinguen por la forma (no solo por el color) y la etiqueta dice nombre y color.
        assert len({_shape(i) for i in ids}) == 3
        assert all(o.kind == "figure" and len(o.label.split()) == 2 for o in e.options)
        shown = [p.id for p in e.pattern]
        assert set(shown) <= set(ids)
        period = next(p for p in (2, 3) if all(s == shown[i % p] for i, s in enumerate(shown)))
        assert len(shown) >= 2 * period and len(set(shown[:period])) >= 2
        assert e.solution == (shown[len(shown) % period],)


def test_toca_la_figura_es_valida_en_miles_de_ejercicios() -> None:
    # Parejas que se confunden (un cuadrado también es rectángulo): nunca juntas.
    confusable = [{"cuadrado", "rectangulo"}, {"cuadrado", "cubo"}, {"rectangulo", "cubo"}]
    confusable.append({"circulo", "esfera"})
    seen: set[str] = set()
    for e in _many("toca-figura-1"):
        shapes = [_shape(o.id) for o in e.options]
        assert len(set(shapes)) == 3 and all(o.kind == "figure" for o in e.options)
        assert not any(pair <= set(shapes) for pair in confusable), shapes
        seen.update(shapes)
        right = next(o for o in e.options if o.id == e.solution[0])
        name = right.label.split()[0]
        assert e.text in (f"Toca el {name}.", f"Toca la {name}.")
        assert sum(o.label.startswith(name + " ") for o in e.options) == 1
    assert len(seen) == 7  # igual salen las 7 formas


def test_donde_esta_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("donde-esta-1"):
        assert e.scene is not None and e.scene.center_name == "caja"
        positions = [p for p, _ in e.scene.places]
        assert positions == ["arriba", "izquierda", "derecha", "abajo"]
        assert [i for _, i in e.scene.places] == [o.id for o in e.options]
        asked = next(p for p in positions if f" {p} " in e.text)
        assert e.solution == (dict(e.scene.places)[asked],)
        if asked in ("izquierda", "derecha"):
            assert "desde donde miras tú" in e.text


def test_mide_con_clips_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("mide-clips-1"):
        assert e.measure is not None and 2 <= e.measure.length <= 8
        assert e.solution == (f"n:{e.measure.length}",)
        assert all(1 <= _num(o.id) <= 10 for o in e.options)
        unit = {"clip": ("clips", "📎"), "paso": ("pasos", "👣")}[e.measure.unit]
        assert e.text.startswith(f"¿Cuántos {unit[0]} mide") and e.measure.glyph == unit[1]
        assert e.measure.name in e.text


def test_pictograma_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("pictograma-1"):
        assert e.picto is not None and 2 <= len(e.picto) <= 3
        counts = [r.count for r in e.picto]
        assert len(set(counts)) == len(counts) and all(1 <= c <= 8 for c in counts)
        asked = next(r for r in e.picto if f"¿Cuántas {r.name} hay?" in e.text)
        assert e.solution == (f"n:{asked.count}",)
        assert len(e.options) == 3 and all(_num(o.id) >= 1 for o in e.options)


@pytest.mark.parametrize(
    ("game_id", "field"),
    [
        ("figura-sigue-1", "pattern"),
        ("toca-figura-1", None),
        ("donde-esta-1", "scene"),
        ("mide-clips-1", "measure"),
        ("pictograma-1", "picto"),
    ],
)
def test_juegos_de_la_parte_3_traen_lo_que_se_dibuja(game_id: str, field: str | None) -> None:
    body = _new(_client(_gateway()), game_id).json()
    for key in ("pattern", "scene", "picto", "measure", "blocks"):
        assert (body[key] is not None) == (key == field)
    if field == "scene":
        assert [p["id"] for p in body["scene"]["places"]] == [o["id"] for o in body["options"]]
    if game_id in ("figura-sigue-1", "toca-figura-1"):
        assert all(o["kind"] == "figure" and o["id"].startswith("f:") for o in body["options"])


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


@pytest.mark.parametrize("break_it", ["mover", "faltar", "repetir", "ajena", "fija-en-hueco"])
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
    elif break_it == "fija-en-hueco":
        answer[gap_i] = e.slots[fixed_i]  # una fija también puesta en un hueco
    else:
        answer[gap_i] = "n:999"
    assert _answer(client, token, answer).status_code == 422


# ---- CU-A21, parte 4: 2° básico ---------------------------------------------------------------


def _path(e: Any) -> tuple[list[int], int]:
    values = [_num(i) for i in e.solution]
    return values, values[1] - values[0]


def test_cuenta_hasta_mil_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("cuenta-mil-2"):
        values, step = _path(e)
        assert step in (10, 100) and len(values) == 5
        assert all(b - a == step for a, b in zip(values, values[1:], strict=False))
        assert values[0] >= 0 and values[-1] <= 1000
        assert e.slots is not None and e.slots[0] is not None and e.slots[1] is not None
        loose = {o.id for o in e.options} - {s for s in e.slots if s is not None}
        assert len(loose) == 4 and all(0 <= _num(i) <= 1000 for i in loose)
        assert valid_answer(e, list(e.solution))


def test_completa_patron_sube_y_baja_en_miles_de_ejercicios() -> None:
    seen = set()
    for e in _many("completa-patron-2"):
        values, step = _path(e)
        assert abs(step) in (2, 5, 10) and len(values) == 6
        assert all(b - a == step for a, b in zip(values, values[1:], strict=False))
        assert min(values) >= 0 and max(values) <= 100
        word = "baja" if step < 0 else "sube"
        assert e.text == f"Completa el patrón: {word} de {abs(step)} en {abs(step)}."
        seen.add(word)
        assert valid_answer(e, list(e.solution))
    assert seen == {"sube", "baja"}


def test_number_words() -> None:
    from app.exercises.games import number_words

    cases = {0: "cero", 16: "dieciséis", 21: "veintiuno", 22: "veintidós", 30: "treinta"}
    cases |= {47: "cuarenta y siete", 99: "noventa y nueve", 100: "cien"}
    assert {n: number_words(n) for n in cases} == cases


def test_lee_el_numero_es_valido_en_miles_de_ejercicios() -> None:
    from app.exercises.games import number_words

    for e in _many("lee-numero-2"):
        n = _num(e.solution[0])
        assert 20 <= n <= 99 and e.text == f"Toca el número {number_words(n)}."
        assert len({o.id for o in e.options}) == 3


def test_decenas_y_unidades_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("arma-numero-2"):
        assert e.blocks is not None
        tens, ones = e.blocks
        assert 1 <= tens <= 9 and 0 <= ones <= 9
        assert e.solution == (f"n:{tens * 10 + ones}",)


def test_suma_con_bloques_mezcla_sin_y_con_reserva() -> None:
    kinds = set()
    for e in _many("suma-bloques-2"):
        a, b = (int(x) for x in e.text.split(" = ")[0].split(" + "))
        assert e.blocks is not None
        tens, ones = e.blocks
        assert tens * 10 + ones == a + b <= 99  # los bloques suman lo mismo
        assert e.solution == (f"n:{a + b}",)
        kinds.add(ones >= 10)
        if ones >= 10:  # olvidar la decena agrupada es un distractor
            assert f"n:{a + b - 10}" in {o.id for o in e.options}
    assert kinds == {True, False}


def test_grupos_iguales_es_valido_en_miles_de_ejercicios() -> None:
    for e in _many("grupos-iguales-2"):
        groups = e.text.rsplit("? ", 1)[1].split(" ")
        sizes = {len(g) // len(g[0]) for g in groups}
        assert len(sizes) == 1 and sizes <= {2, 5, 10} and len(groups) >= 2
        assert _num(e.solution[0]) == sizes.pop() * len(groups)
        assert e.text.startswith("¿Cuántas ")


def test_bloques_viajan_en_el_ejercicio() -> None:
    body = _new(_client(_gateway(grade=2)), "arma-numero-2").json()
    assert set(body["blocks"]) == {"tens", "ones"}
