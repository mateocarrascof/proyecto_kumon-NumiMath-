"""T27: el tutor titular ve y borra las hojas de su hijo (PIN para ver y PIN reciente al borrar)."""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db.gateway import (
    GatewayError,
    TutorSheetDetail,
    TutorSheetItem,
    TutorSheetsPage,
)
from app.main import create_app
from app.parental import issue_parental_token
from tests.test_auth import SECRET, _hs256, _settings
from tests.test_teacher_reads import SIGN

TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
STUDENT = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
OTHER = uuid.UUID("bbbbbbbb-0000-0000-0000-0000000000ff")
SHEET = uuid.UUID("cccccccc-0000-0000-0000-000000000001")
WHEN = datetime(2026, 11, 12, 15, 30, tzinfo=UTC)
STROKE = {"eraser": False, "color": "#2b2d42", "width": 4, "points": [[10, 10], [20, 20]]}


@dataclass
class Gw:
    page: TutorSheetsPage | None = field(
        default_factory=lambda: TutorSheetsPage(
            [
                TutorSheetItem(SHEET, "tarea_tutor", True, "Carla vive en Los Pinos", WHEN),
                TutorSheetItem(uuid.uuid4(), "2-01", False, "7 + 5", WHEN),
            ],
            True,
            5,
        )
    )
    detail: TutorSheetDetail | None = field(
        default_factory=lambda: TutorSheetDetail(
            SHEET, "2-01", False, WHEN, "75 - 38", "47", "37", [STROKE]
        )
    )
    delete_one: str = "ok"
    delete_all: int | None = 5
    fail: bool = False
    calls: list[tuple[str, Any]] = field(default_factory=list)

    def _maybe(self) -> None:
        if self.fail:
            raise GatewayError("status_500")

    async def list_student_sheets(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, offset: int, limit: int
    ) -> TutorSheetsPage | None:
        self._maybe()
        self.calls.append(("list", (tutor_id, student_id, offset, limit)))
        return self.page if student_id == STUDENT else None

    async def get_student_sheet(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, sheet_id: uuid.UUID
    ) -> TutorSheetDetail | None:
        self._maybe()
        return self.detail if (student_id, sheet_id) == (STUDENT, SHEET) else None

    async def delete_student_sheet(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, sheet_id: uuid.UUID
    ) -> str:
        self._maybe()
        self.calls.append(("delete_one", (tutor_id, student_id, sheet_id)))
        return self.delete_one if student_id == STUDENT else "not_found"

    async def delete_student_sheets(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> int | None:
        self._maybe()
        self.calls.append(("delete_all", (tutor_id, student_id)))
        return self.delete_all if student_id == STUDENT else None

    async def aclose(self) -> None:
        return None


def _client(gw: Gw) -> TestClient:
    settings = _settings(supabase_jwt_secret=SECRET, exercise_signing_key=SIGN)
    return TestClient(create_app(settings, gateway=gw), raise_server_exceptions=False)  # type: ignore[arg-type]


def _tutor(pin_age: float | None = 0, **claims: Any) -> dict[str, str]:
    """`pin_age`: segundos desde que se verificó el PIN; `None` = sin token del PIN."""
    headers = {"Authorization": f"Bearer {_hs256(sub=str(TUTOR), **claims)}"}
    if pin_age is not None:
        headers["X-Parental-Token"] = issue_parental_token(
            SIGN.encode(), TUTOR, now=time.time() - pin_age
        )
    return headers


LIST = f"/v1/students/{STUDENT}/sheets"
ONE = f"{LIST}/{SHEET}"


# ------------------------------------------------------------------ ver


def test_el_tutor_ve_la_lista_con_fecha_ejercicio_resultado_y_el_total() -> None:
    response = _client(Gw()).get(LIST, headers=_tutor())
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 5 and body["has_more"] is True and body["next_offset"] == 2
    assert set(body["items"][1]) == {
        "id",
        "label",
        "tutor_task",
        "correct",
        "statement",
        "saved_at",
    }
    assert body["items"][1]["statement"] == "7 + 5"
    assert body["items"][1]["saved_at"].startswith("2026-11-12T15:30")
    assert "strokes" not in response.text


def test_de_una_tarea_del_tutor_nunca_sale_su_texto_aunque_llegara_de_la_base() -> None:
    body = _client(Gw()).get(LIST, headers=_tutor()).json()
    assert body["items"][0]["tutor_task"] is True
    assert body["items"][0]["statement"] == "Tarea del tutor"
    assert "Carla" not in str(body)


def test_el_tutor_abre_una_hoja_con_trazos_y_las_dos_respuestas() -> None:
    response = _client(Gw()).get(ONE, headers=_tutor())
    assert response.status_code == 200
    body = response.json()
    assert (body["statement"], body["child_answer"], body["correct_answer"]) == (
        "75 - 38",
        "47",
        "37",
    )
    assert body["strokes"][0]["points"] == [[10.0, 10.0], [20.0, 20.0]]


def test_perfil_ajeno_o_inexistente_y_hoja_ajena_dan_el_mismo_404() -> None:
    client = _client(Gw())
    other_list = client.get(f"/v1/students/{OTHER}/sheets", headers=_tutor())
    other_one = client.get(f"/v1/students/{OTHER}/sheets/{SHEET}", headers=_tutor())
    no_sheet = client.get(f"{LIST}/{uuid.uuid4()}", headers=_tutor())
    assert {other_list.status_code, other_one.status_code, no_sheet.status_code} == {404}
    messages = {r.json()["error"]["message"] for r in (other_list, other_one, no_sheet)}
    assert len(messages) == 1


def test_la_paginacion_pasa_el_desplazamiento_y_valida_los_parametros() -> None:
    gw = Gw()
    assert _client(gw).get(f"{LIST}?offset=4&limit=10", headers=_tutor()).status_code == 200
    assert gw.calls[-1] == ("list", (TUTOR, STUDENT, 4, 10))
    for query in ("offset=-1", "limit=0", "limit=51"):
        assert _client(Gw()).get(f"{LIST}?{query}", headers=_tutor()).status_code == 422


# ------------------------------------------------------------------ borrar


def test_borrar_una_hoja_responde_204_con_el_pin_reciente() -> None:
    gw = Gw()
    response = _client(gw).delete(ONE, headers=_tutor(pin_age=5))
    assert response.status_code == 204 and response.content == b""
    assert gw.calls[-1] == ("delete_one", (TUTOR, STUDENT, SHEET))


def test_borrar_todas_dice_cuantas_se_borraron() -> None:
    gw = Gw(delete_all=7)
    response = _client(gw).delete(LIST, headers=_tutor(pin_age=5))
    assert response.status_code == 200 and response.json() == {"deleted": 7}
    assert gw.calls[-1] == ("delete_all", (TUTOR, STUDENT))


@pytest.mark.parametrize("path", [ONE, LIST])
def test_borrar_exige_el_pin_recien_verificado(path: str) -> None:
    gw = Gw()
    client = _client(gw)
    assert client.delete(path, headers=_tutor(pin_age=None)).status_code == 401
    stale = client.delete(path, headers=_tutor(pin_age=600))
    assert stale.status_code == 401 and stale.json()["error"]["code"] == "parental_required"
    assert not [c for c in gw.calls if c[0].startswith("delete")]


@pytest.mark.parametrize("path", [LIST, ONE])
def test_ver_exige_el_pin_activo_y_sin_sesion_es_401(path: str) -> None:
    assert _client(Gw()).get(path, headers=_tutor(pin_age=None)).status_code == 401
    assert _client(Gw()).get(path).status_code == 401


def test_borrar_algo_ajeno_o_que_no_existe_da_404() -> None:
    client = _client(Gw(delete_one="not_found"))
    assert client.delete(ONE, headers=_tutor()).status_code == 404
    assert client.delete(f"/v1/students/{OTHER}/sheets", headers=_tutor()).status_code == 404
    assert (
        client.delete(f"/v1/students/{OTHER}/sheets/{SHEET}", headers=_tutor()).status_code == 404
    )


@pytest.mark.parametrize("path", [LIST, ONE])
@pytest.mark.parametrize(
    "claims", [{"app_metadata": {"role": "teacher"}}, {"app_metadata": {"role": "admin"}}]
)
def test_un_docente_o_admin_no_entra_a_las_hojas_del_tutor(
    path: str, claims: dict[str, Any]
) -> None:
    client = _client(Gw())
    assert client.get(path, headers=_tutor(**claims)).status_code == 403
    assert client.delete(path, headers=_tutor(**claims)).status_code == 403


@pytest.mark.parametrize("path", [LIST, ONE])
def test_con_la_base_caida_responde_503(path: str) -> None:
    client = _client(Gw(fail=True))
    assert client.get(path, headers=_tutor()).status_code == 503
    assert client.delete(path, headers=_tutor()).status_code == 503


def test_no_hay_ids_ni_contenido_en_los_logs(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client = _client(Gw())
    client.get(ONE, headers=_tutor())
    client.delete(ONE, headers=_tutor())
    client.delete(LIST, headers=_tutor())
    assert str(STUDENT) not in caplog.text and str(SHEET) not in caplog.text
    assert "75 - 38" not in caplog.text and "2b2d42" not in caplog.text
