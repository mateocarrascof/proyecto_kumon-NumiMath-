"""T22: exportar el historial y las estadísticas en CSV (PIN, sin fórmulas, sin guardar archivo)."""

from __future__ import annotations

import csv
import io
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db.gateway import AttemptRow, GatewayError
from app.main import create_app
from app.parental import issue_parental_token
from app.routes.export import safe_cell
from tests.fakes import FakeGateway
from tests.test_auth import SECRET, _hs256, _settings
from tests.test_teacher_reads import SIGN

TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
STUDENT = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
PATH = f"/v1/students/{STUDENT}/export.csv"
WHEN = datetime(2026, 11, 12, 15, 30, tzinfo=UTC)


class Gw(FakeGateway):
    rows: list[AttemptRow]
    fail: bool = False

    async def list_attempts(self, tutor_id, student_id, limit):  # type: ignore[no-untyped-def]
        if self.fail:
            raise GatewayError("status_500")
        return self.rows


def _gw(rows: list[AttemptRow]) -> Gw:
    gw = Gw(outcomes={(TUTOR, STUDENT): "ok"}, grades={(TUTOR, STUDENT): 2})
    gw.rows = rows
    return gw


def _client(gw: Gw) -> TestClient:
    settings = _settings(supabase_jwt_secret=SECRET, exercise_signing_key=SIGN)
    return TestClient(create_app(settings, gateway=gw), raise_server_exceptions=False)


def _h(sub: uuid.UUID = TUTOR, pin: bool = True, **claims: object) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {_hs256(sub=str(sub), **claims)}"}
    if pin:
        headers["X-Parental-Token"] = issue_parental_token(SIGN.encode(), sub)
    return headers


ROWS = [
    AttemptRow("2-01", True, WHEN, 12),
    AttemptRow("2-01", False, WHEN, None),
    AttemptRow("tarea_tutor", True, WHEN, 20),
]


def _parse(body: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(body.lstrip("﻿"))))


def test_el_tutor_descarga_estadisticas_e_historial() -> None:
    response = _client(_gw(ROWS)).get(PATH, headers=_h())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    rows = _parse(response.text)
    assert ["Total", "3", "2", "67%"] in rows
    assert ["2026-11-12 15:30", "Tarea del tutor", "Correcta", "20"] in rows  # hora UTC
    assert any(r[2:3] == ["Incorrecta"] and r[3:4] == [""] for r in rows)  # sin tiempo: vacío


def test_la_columna_de_fecha_dice_utc() -> None:
    rows = _parse(_client(_gw(ROWS)).get(PATH, headers=_h()).text)
    assert ["fecha_hora_utc", "Habilidad", "Resultado", "Segundos"] in rows


def test_si_el_historial_supera_las_5000_filas_lo_avisa_al_final() -> None:
    many = [AttemptRow("2-01", True, WHEN, 5)] * 5001
    body = _client(_gw(many)).get(PATH, headers=_h()).text
    rows = _parse(body)
    assert rows[-1] == ["Se muestran solo las 5000 filas más recientes."]
    assert sum(1 for r in rows if r[:1] and r[0].startswith("2026-")) == 5000


def test_con_5000_filas_justas_no_hay_aviso() -> None:
    body = _client(_gw([AttemptRow("2-01", True, WHEN, 5)] * 5000)).get(PATH, headers=_h()).text
    assert "Se muestran solo" not in body


def test_de_las_tareas_del_tutor_solo_sale_tarea_del_tutor() -> None:
    body = _client(_gw(ROWS)).get(PATH, headers=_h()).text
    assert "tarea_tutor" not in body


@pytest.mark.parametrize("start", ["=", "+", "-", "@", "\t", "\r"])
def test_safe_cell_neutraliza_formulas(start: str) -> None:
    assert safe_cell(f"{start}HYPERLINK(1)") == f"'{start}HYPERLINK(1)"
    assert safe_cell("Sumas") == "Sumas"


@pytest.mark.parametrize("prefix", [" ", "  ", " \t", "\t ", "   \t  "])
@pytest.mark.parametrize("sign", ["=", "+", "-", "@"])
def test_safe_cell_neutraliza_formulas_tras_espacios_o_tabs(prefix: str, sign: str) -> None:
    cell = f"{prefix}{sign}SUM(1)"
    assert safe_cell(cell) == "'" + cell


def test_safe_cell_no_toca_texto_normal_con_espacios() -> None:
    assert safe_cell("  Sumas y restas") == "  Sumas y restas"
    assert safe_cell("Resta - sumas") == "Resta - sumas"


def test_ninguna_celda_empieza_con_un_caracter_de_formula(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.routes.export as export

    monkeypatch.setattr(export, "topic_label", lambda grade, topic: "=CMD()|' /C calc'!A0")
    body = _client(_gw(ROWS)).get(PATH, headers=_h()).text
    cells = [c for row in _parse(body) for c in row]
    assert "'=CMD()|' /C calc'!A0" in cells
    assert not [c for c in cells if c[:1] in "=+-@\t\r" and c]


def test_sin_datos_se_informa_y_no_hay_archivo() -> None:
    response = _client(_gw([])).get(PATH, headers=_h())
    assert response.status_code == 404 and response.json()["error"]["code"] == "no_data"


def test_exige_el_pin_y_la_sesion() -> None:
    client = _client(_gw(ROWS))
    assert client.get(PATH).status_code == 401
    assert client.get(PATH, headers=_h(pin=False)).status_code == 401


def test_otro_tutor_o_un_docente_no_exportan() -> None:
    client = _client(_gw(ROWS))
    assert client.get(PATH, headers=_h(OTRO)).status_code == 403
    assert client.get(PATH, headers=_h(app_metadata={"role": "teacher"})).status_code == 403


def test_con_la_base_caida_responde_503() -> None:
    gw = _gw(ROWS)
    gw.fail = True
    assert _client(gw).get(PATH, headers=_h()).status_code == 503


def test_no_se_guarda_archivo_ni_contenido_en_logs(
    caplog: pytest.LogCaptureFixture, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    caplog.set_level(logging.DEBUG)
    monkeypatch.chdir(tmp_path)
    _client(_gw(ROWS)).get(PATH, headers=_h())
    assert list(tmp_path.iterdir()) == []
    assert "Tarea del tutor" not in caplog.text and str(STUDENT) not in caplog.text
