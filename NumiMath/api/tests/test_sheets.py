"""Hojas del papel: guardar (CU-A22, con el JWT del tutor) y verlas (CU-D8, solo lectura)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db.gateway import GatewayError, SheetDetail, SheetPage, SheetSummary
from app.exercises.tokens import issue, verify
from app.main import create_app
from tests.fakes import FakeGateway
from tests.test_auth import SECRET, _hs256, _settings
from tests.test_teacher_reads import SIGN

TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
STUDENT = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
TEACHER = uuid.UUID("dddddddd-0000-0000-0000-000000000001")
SHEET = uuid.UUID("cccccccc-0000-0000-0000-000000000001")
KEY = SIGN.encode()
STROKE = {"eraser": False, "color": "#2b2d42", "width": 4, "points": [[10, 10], [20.4, 30.6]]}
BODY = {"strokes": [STROKE]}


def _gateway(**kwargs: Any) -> FakeGateway:
    return FakeGateway(outcomes={(TUTOR, STUDENT): "ok"}, grades={(TUTOR, STUDENT): 1}, **kwargs)


def _client(gateway: Any) -> TestClient:
    settings = _settings(supabase_jwt_secret=SECRET, exercise_signing_key=SIGN)
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _auth(sub: uuid.UUID = TUTOR, **claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {_hs256(sub=str(sub), **claims)}"}


def _issued(topic: str = "1-08") -> Any:
    issued = issue(KEY, STUDENT, topic, 600, level=1)
    assert issued is not None
    return issued


PATH = f"/v1/students/{STUDENT}/exercises/sheet"


# ------------------------------------------------------------------ A22 (guardar)


def test_guarda_la_hoja_con_la_respuesta_corregida_por_el_servidor() -> None:
    gw = _gateway()
    issued = _issued()
    answer = verify(KEY, issued.token, STUDENT).exercise.answer
    response = _client(gw).post(
        PATH, json={"token": issued.token, "answer": answer, **BODY}, headers=_auth()
    )
    assert response.status_code == 200 and response.json() == {"saved": True}
    student, exercise_id, child, correct, right, strokes = gw.sheets[0]
    assert (student, exercise_id) == (STUDENT, issued.exercise_id)
    assert (child, correct, right) == (str(answer), True, str(answer))
    # Los puntos se guardan enteros (menos peso, la cuadrícula es de 24 px).
    assert strokes[0]["points"] == [[10, 10], [20, 31]]


def test_una_respuesta_incorrecta_se_guarda_como_incorrecta() -> None:
    gw = _gateway()
    issued = _issued()
    answer = verify(KEY, issued.token, STUDENT).exercise.answer
    _client(gw).post(
        PATH, json={"token": issued.token, "answer": answer + 1, **BODY}, headers=_auth()
    )
    assert gw.sheets[0][3] is False


def test_sin_docente_vinculado_no_guarda_y_no_asusta() -> None:
    gw = _gateway(sheet_status="no_link")
    issued = _issued()
    response = _client(gw).post(
        PATH, json={"token": issued.token, "answer": 1, **BODY}, headers=_auth()
    )
    assert response.status_code == 200 and response.json() == {"saved": False}


@pytest.mark.parametrize("status", ["no_attempt", "mismatch", "not_found"])
def test_otros_resultados_de_la_base_son_saved_false(status: str) -> None:
    gw = _gateway(sheet_status=status)
    issued = _issued()
    response = _client(gw).post(
        PATH, json={"token": issued.token, "answer": 1, **BODY}, headers=_auth()
    )
    assert response.status_code == 200 and response.json() == {"saved": False}


def test_con_la_base_caida_responde_503() -> None:
    gw = _gateway(sheet_error=GatewayError("status_500"))
    issued = _issued()
    response = _client(gw).post(
        PATH, json={"token": issued.token, "answer": 1, **BODY}, headers=_auth()
    )
    assert response.status_code == 503


def test_un_token_invalido_o_de_otro_perfil_no_guarda() -> None:
    gw = _gateway()
    other = issue(KEY, uuid.uuid4(), "1-08", 600, level=1)
    assert other is not None
    for token in ("x" * 20, other.token):
        response = _client(gw).post(
            PATH, json={"token": token, "answer": 1, **BODY}, headers=_auth()
        )
        assert response.status_code == 422
    assert gw.sheets == []


def test_perfil_ajeno_o_sin_sesion() -> None:
    gw = _gateway()
    issued = _issued()
    body = {"token": issued.token, "answer": 1, **BODY}
    assert _client(gw).post(PATH, json=body).status_code == 401
    assert _client(gw).post(PATH, json=body, headers=_auth(uuid.uuid4())).status_code == 403
    assert gw.sheets == []


@pytest.mark.parametrize(
    "extra",
    [
        {"image": "data:image/png;base64,AAAA"},
        {"device": "Pixel 7"},
        {"strokes": [{**STROKE, "pressure": 0.5}]},
        {"strokes": [{**STROKE, "color": "url(javascript:alert(1))"}]},
        {"strokes": [{**STROKE, "points": []}]},
        {"strokes": [{**STROKE, "points": [[5000, 1]]}]},
        {"strokes": [STROKE] * 601},
        {"strokes": [{**STROKE, "points": [[1, 1]] * 3001}]},
        {"strokes": [{**STROKE, "points": [[1, 1]] * 2500}] * 5},
    ],
)
def test_solo_trazos_vectoriales_con_tope_de_tamano(extra: dict[str, Any]) -> None:
    gw = _gateway()
    issued = _issued()
    body = {"token": issued.token, "answer": 1, **BODY, **extra}
    response = _client(gw).post(PATH, json=body, headers=_auth())
    assert response.status_code == 422
    assert gw.sheets == []


def test_una_hoja_grande_pasa_el_limite_de_cuerpo_de_las_hojas_pero_no_el_de_otras_rutas() -> None:
    gw = _gateway()
    issued = _issued()
    big = {"strokes": [{**STROKE, "points": [[123, 456]] * 2000}] * 6}  # ~12 000 puntos, ~130 KB
    body = {"token": issued.token, "answer": 1, **big}
    assert _client(gw).post(PATH, json=body, headers=_auth()).status_code == 200
    # Otra ruta con el mismo cuerpo sigue limitada a 8 KB.
    other = _client(gw).post(f"/v1/students/{STUDENT}/exercises/answer", json=body, headers=_auth())
    assert other.status_code == 413


def test_la_hoja_de_una_tarea_del_tutor_no_lleva_texto() -> None:
    gw = _gateway()
    assignment = uuid.uuid4()
    response = _client(gw).post(
        f"/v1/students/{STUDENT}/assignments/{assignment}/sheet",
        json={"answer": 10, **BODY},
        headers=_auth(),
    )
    assert response.status_code == 200 and response.json() == {"saved": True}
    student, exercise_id, child, correct, right, _ = gw.sheets[0]
    assert (student, exercise_id, child) == (STUDENT, assignment, "10")
    # Lo corrige la base con la respuesta de la tarea: la API no la conoce.
    assert correct is None and right is None


def test_no_hay_trazos_ni_ids_en_los_logs(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    gw = _gateway(sheet_status="no_link")
    issued = _issued()
    _client(gw).post(PATH, json={"token": issued.token, "answer": 1, **BODY}, headers=_auth())
    assert str(STUDENT) not in caplog.text and "2b2d42" not in caplog.text


def test_el_limite_por_tutor_responde_429_sin_guardar() -> None:
    issued = _issued()
    response = _client(_gateway(sheet_status="rate_limited")).post(
        PATH, json={"token": issued.token, "answer": 1, **BODY}, headers=_auth()
    )
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"


# ------------------------------------------------------------------ B4: ¿hay vínculo?

ENABLED = f"/v1/students/{STUDENT}/sheets/enabled"


@pytest.mark.parametrize("link", [True, False])
def test_enabled_dice_si_hay_docente_vinculado_con_texto_que_cubre_las_hojas(link: bool) -> None:
    response = _client(_gateway(sheet_link=link)).get(ENABLED, headers=_auth())
    assert response.status_code == 200 and response.json() == {"enabled": link}


def test_enabled_ante_un_fallo_de_la_base_es_false_sin_error() -> None:
    gw = _gateway(sheet_error=GatewayError("status_500"))
    response = _client(gw).get(ENABLED, headers=_auth())
    assert response.status_code == 200 and response.json() == {"enabled": False}


def test_enabled_exige_sesion_y_perfil_propio() -> None:
    assert _client(_gateway()).get(ENABLED).status_code == 401
    assert _client(_gateway()).get(ENABLED, headers=_auth(uuid.uuid4())).status_code == 403


# ------------------------------------------------------------------ D8 (el docente lee)


@dataclass
class Gw:
    page: SheetPage | None = field(
        default_factory=lambda: SheetPage(
            [
                SheetSummary(SHEET, "tarea_tutor", False, "2026-11-12"),
                SheetSummary(uuid.uuid4(), "2-01", True, "2026-11-11"),
            ],
            True,
        )
    )
    detail: SheetDetail | None = field(
        default_factory=lambda: SheetDetail(
            SHEET,
            "2-01",
            False,
            "2026-11-12",
            "75 - 38",
            "47",
            "37",
            [{**STROKE, "points": [[10, 10], [20, 20]]}],
        )
    )
    fail: bool = False
    calls: list[Any] = field(default_factory=list)

    async def teacher_profile(self, teacher_id: uuid.UUID) -> Any:
        from app.db.gateway import TeacherProfile

        return TeacherProfile("Docente", "AAAA2345")

    async def teacher_student_sheets(
        self, teacher_id: uuid.UUID, student_id: uuid.UUID, offset: int, limit: int
    ) -> SheetPage | None:
        if self.fail:
            raise GatewayError("status_500")
        self.calls.append((offset, limit))
        return self.page if student_id == STUDENT else None

    async def teacher_student_sheet(
        self, teacher_id: uuid.UUID, student_id: uuid.UUID, sheet_id: uuid.UUID
    ) -> SheetDetail | None:
        if self.fail:
            raise GatewayError("status_500")
        return self.detail if (student_id, sheet_id) == (STUDENT, SHEET) else None

    async def aclose(self) -> None:
        return None


def _teacher() -> dict[str, str]:
    return _auth(TEACHER, app_metadata={"role": "teacher"})


LIST = f"/v1/teacher/students/{STUDENT}/sheets"
ONE = f"{LIST}/{SHEET}"


def test_el_docente_ve_la_lista_sin_trazos_y_sin_texto_de_tareas() -> None:
    response = _client(Gw()).get(LIST, headers=_teacher())
    assert response.status_code == 200
    body = response.json()
    assert body["has_more"] is True and body["next_offset"] == 2
    assert set(body["items"][0]) == {"id", "label", "tutor_task", "correct", "day"}
    assert body["items"][0]["tutor_task"] is True


def test_el_docente_ve_una_hoja_completa() -> None:
    response = _client(Gw()).get(ONE, headers=_teacher())
    assert response.status_code == 200
    body = response.json()
    assert (body["statement"], body["child_answer"], body["correct_answer"]) == (
        "75 - 38",
        "47",
        "37",
    )
    assert body["strokes"][0]["points"] == [[10.0, 10.0], [20.0, 20.0]]


def test_en_una_tarea_del_tutor_el_enunciado_siempre_es_tarea_del_tutor() -> None:
    gw = Gw(
        detail=SheetDetail(
            SHEET, "tarea_tutor", False, "2026-11-12", "Carla vive en Los Pinos", "1", "2", []
        )
    )
    response = _client(gw).get(ONE, headers=_teacher())
    assert response.json()["statement"] == "Tarea del tutor"
    assert "Carla" not in response.text


def test_sin_acceso_hoja_inexistente_y_nino_inexistente_dan_el_mismo_404() -> None:
    gw = Gw(page=None)
    client = _client(gw)
    other_student = uuid.uuid4()
    bodies = {
        client.get(LIST, headers=_teacher()).text,
        client.get(f"/v1/teacher/students/{other_student}/sheets", headers=_teacher()).text,
        client.get(f"{LIST}/{uuid.uuid4()}", headers=_teacher()).text,
        client.get(f"/v1/teacher/students/{other_student}/sheets/{SHEET}", headers=_teacher()).text,
    }
    assert len({b.split('"request_id"')[0] for b in bodies}) == 1
    assert (
        client.get(ONE.replace(str(SHEET), str(uuid.uuid4())), headers=_teacher()).status_code
        == 404
    )


@pytest.mark.parametrize("path", [LIST, ONE])
@pytest.mark.parametrize("claims", [{}, {"app_metadata": {"role": "admin"}}])
def test_un_tutor_o_admin_no_lee_las_hojas_por_la_zona_del_docente(
    path: str, claims: dict[str, Any]
) -> None:
    assert _client(Gw()).get(path, headers=_auth(TUTOR, **claims)).status_code == 403


@pytest.mark.parametrize("path", [LIST, ONE])
def test_sin_token_es_401_y_el_docente_solo_lee_y_con_la_base_caida_es_503(path: str) -> None:
    assert _client(Gw()).get(path).status_code == 401
    for method in ("post", "put", "patch", "delete"):
        assert getattr(_client(Gw()), method)(path, headers=_teacher()).status_code == 405
    assert _client(Gw(fail=True)).get(path, headers=_teacher()).status_code == 503


def test_paginacion_de_hojas_valida_los_parametros() -> None:
    gw = Gw()
    assert _client(gw).get(f"{LIST}?offset=4&limit=10", headers=_teacher()).status_code == 200
    assert gw.calls[-1] == (4, 10)
    for query in ("offset=-1", "limit=0", "limit=51"):
        assert _client(Gw()).get(f"{LIST}?{query}", headers=_teacher()).status_code == 422
