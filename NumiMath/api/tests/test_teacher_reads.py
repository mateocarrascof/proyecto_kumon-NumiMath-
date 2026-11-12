"""Lecturas del docente (D4, D5, D7) y del tutor (T5): solo lectura, sin acceso = mismo 404."""

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
    HistoryItem,
    HistoryPage,
    SkillState,
    TeacherProfile,
    TeacherProgress,
    TeacherStudent,
    TutorAttempt,
    TutorHistoryPage,
)
from app.main import create_app
from app.parental import issue_parental_token
from tests.test_auth import SECRET, _hs256, _settings

SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
TEACHER = uuid.UUID("dddddddd-0000-0000-0000-000000000001")
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
STUDENT = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
UNKNOWN = uuid.UUID("bbbbbbbb-0000-0000-0000-0000000000ff")
TEACHER_CLAIMS = {"app_metadata": {"role": "teacher"}}


@dataclass
class Gw:
    profile: TeacherProfile | None = field(
        default_factory=lambda: TeacherProfile("Docente", "AAAA2345")
    )
    students: list[TeacherStudent] = field(
        default_factory=lambda: [TeacherStudent(STUDENT, "Ana", 2)]
    )
    progress: TeacherProgress | None = field(
        default_factory=lambda: TeacherProgress(
            "Ana", 2, [SkillState("2-01", 2, 3, 2, False), SkillState("zzz", 3, 0, 0, True)]
        )
    )
    history: HistoryPage | None = field(
        default_factory=lambda: HistoryPage(
            [
                HistoryItem("tarea_tutor", "Carla vive en Los Pinos 123", False, 1, "2026-11-12"),
                HistoryItem("2-01", "7 + 5", True, 2, "2026-11-11"),
            ],
            True,
        )
    )
    tutor_page: TutorHistoryPage | None = field(
        default_factory=lambda: TutorHistoryPage(
            [
                TutorAttempt("2-01", True, 2, datetime(2026, 11, 12, 15, 30, tzinfo=UTC)),
                TutorAttempt("tarea_tutor", False, 1, datetime(2026, 11, 12, 15, 0, tzinfo=UTC)),
            ],
            False,
        )
    )
    fail: set[str] = field(default_factory=set)
    calls: list[tuple[str, Any]] = field(default_factory=list)

    def _maybe(self, name: str) -> None:
        self.calls.append((name, None))
        if name in self.fail:
            raise GatewayError("status_500")

    async def teacher_profile(self, teacher_id: uuid.UUID) -> TeacherProfile | None:
        return self.profile

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        return "ok" if student_id == STUDENT else "student_not_found"

    async def teacher_students(self, teacher_id: uuid.UUID) -> list[TeacherStudent]:
        self._maybe("students")
        return self.students

    async def teacher_student_progress(
        self, teacher_id: uuid.UUID, student_id: uuid.UUID
    ) -> TeacherProgress | None:
        self._maybe("progress")
        return self.progress if student_id == STUDENT else None

    async def teacher_student_history(
        self, teacher_id: uuid.UUID, student_id: uuid.UUID, offset: int, limit: int
    ) -> HistoryPage | None:
        self._maybe("history")
        self.calls.append(("history_args", (offset, limit)))
        return self.history if student_id == STUDENT else None

    async def list_student_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, offset: int, limit: int
    ) -> TutorHistoryPage | None:
        self._maybe("tutor_history")
        self.calls.append(("tutor_args", (offset, limit)))
        return self.tutor_page

    async def aclose(self) -> None:
        return None


def _client(gw: Gw) -> TestClient:
    settings = _settings(supabase_jwt_secret=SECRET, exercise_signing_key=SIGN)
    return TestClient(create_app(settings, gateway=gw), raise_server_exceptions=False)  # type: ignore[arg-type]


def _t(**claims: Any) -> dict[str, str]:
    claims = claims or TEACHER_CLAIMS
    return {"Authorization": f"Bearer {_hs256(sub=str(TEACHER), **claims)}"}


READS = [
    "/v1/teacher/students",
    f"/v1/teacher/students/{STUDENT}/progress",
    f"/v1/teacher/students/{STUDENT}/history",
]


# ------------------------------------------------------------------ D4


def test_el_docente_ve_solo_apodo_y_curso_de_sus_alumnos() -> None:
    response = _client(Gw()).get("/v1/teacher/students", headers=_t())
    assert response.status_code == 200
    assert response.json() == {
        "students": [{"student_id": str(STUDENT), "nickname": "Ana", "grade": 2}]
    }
    assert response.headers["cache-control"] == "no-store"


def test_sin_alumnos_la_lista_es_vacia() -> None:
    assert _client(Gw(students=[])).get("/v1/teacher/students", headers=_t()).json() == {
        "students": []
    }


# ------------------------------------------------------------------ D5


def test_progreso_por_habilidad_con_nombre_y_sin_tiempos_ni_racha() -> None:
    response = _client(Gw()).get(f"/v1/teacher/students/{STUDENT}/progress", headers=_t())
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"nickname", "grade", "skills"}
    first = data["skills"][0]
    assert first["label"] == "Contar de 2, 5, 10 y 100" and first["module"]
    assert set(first) == {
        "code",
        "label",
        "module",
        "level",
        "block_total",
        "block_correct",
        "mastered",
    }
    assert data["skills"][1]["label"] == "zzz"  # código desconocido: se muestra tal cual
    assert response.headers["cache-control"] == "no-store"
    text = response.text.lower()
    assert "duration" not in text and "streak" not in text and "racha" not in text


def test_sin_acceso_o_niño_inexistente_responden_exactamente_lo_mismo() -> None:
    client = _client(Gw(progress=None))
    unlinked = client.get(f"/v1/teacher/students/{STUDENT}/progress", headers=_t())
    missing = client.get(f"/v1/teacher/students/{UNKNOWN}/progress", headers=_t())
    assert unlinked.status_code == missing.status_code == 404
    strip = lambda r: {k: v for k, v in r.json()["error"].items() if k != "request_id"}  # noqa: E731
    assert strip(unlinked) == strip(missing)
    for path in (
        f"/v1/teacher/students/{STUDENT}/history",
        f"/v1/teacher/students/{UNKNOWN}/history",
    ):
        assert _client(Gw(history=None)).get(path, headers=_t()).status_code == 404


def test_id_de_alumno_mal_formado_es_422() -> None:
    assert (
        _client(Gw()).get("/v1/teacher/students/no-es-uuid/progress", headers=_t()).status_code
        == 422
    )


# ------------------------------------------------------------------ D7


def test_historial_sin_el_texto_de_la_tarea_del_tutor_aunque_llegara_de_la_base() -> None:
    response = _client(Gw()).get(f"/v1/teacher/students/{STUDENT}/history", headers=_t())
    assert response.status_code == 200
    data = response.json()
    task, generated = data["items"]
    assert (
        task["tutor_task"] is True
        and task["exercise"] is None
        and task["label"] == "Tareas del tutor"
    )
    assert generated["exercise"] == "7 + 5" and generated["tutor_task"] is False
    assert generated["label"] == "Contar de 2, 5, 10 y 100"
    assert "Carla" not in response.text and "Pinos" not in response.text
    assert set(generated) == {"label", "tutor_task", "exercise", "correct", "level", "day"}
    assert generated["day"] == "2026-11-11"  # solo el día, sin hora ni duración
    assert data["has_more"] is True and data["next_offset"] == 2


def test_paginacion_pasa_offset_y_limite_a_la_base_y_calcula_el_siguiente() -> None:
    gw = Gw()
    client = _client(gw)
    client.get(f"/v1/teacher/students/{STUDENT}/history?offset=60&limit=20", headers=_t())
    assert ("history_args", (60, 20)) in gw.calls
    last = _client(
        Gw(history=HistoryPage([HistoryItem("2-01", "1 + 1", True, 1, "2026-11-10")], False))
    )
    data = last.get(f"/v1/teacher/students/{STUDENT}/history", headers=_t()).json()
    assert data["has_more"] is False and data["next_offset"] is None


@pytest.mark.parametrize("query", ["limit=0", "limit=51", "offset=-1", "limit=abc", "offset=5001"])
def test_parametros_de_paginacion_invalidos_responden_422(query: str) -> None:
    gw = Gw()
    response = _client(gw).get(f"/v1/teacher/students/{STUDENT}/history?{query}", headers=_t())
    assert response.status_code == 422
    assert not any(c[0] == "history_args" for c in gw.calls)


def test_historial_vacio() -> None:
    gw = Gw(history=HistoryPage([], False))
    data = _client(gw).get(f"/v1/teacher/students/{STUDENT}/history", headers=_t()).json()
    assert data == {"items": [], "has_more": False, "next_offset": None}


# ------------------------------------------------------------------ roles y solo lectura


@pytest.mark.parametrize("path", READS)
@pytest.mark.parametrize("claims", [{}, {"app_metadata": {"role": "admin"}}])
def test_un_tutor_o_admin_no_lee_por_las_rutas_del_docente(
    path: str, claims: dict[str, Any]
) -> None:
    gw = Gw()
    headers = {"Authorization": f"Bearer {_hs256(sub=str(TUTOR), **claims)}"}
    assert _client(gw).get(path, headers=headers).status_code == 403
    assert not any(c[0] in {"students", "progress", "history"} for c in gw.calls)


@pytest.mark.parametrize("path", READS)
def test_un_docente_eliminado_con_token_vigente_no_lee_nada(path: str) -> None:
    gw = Gw(profile=None)
    assert _client(gw).get(path, headers=_t()).status_code == 403
    assert not any(c[0] in {"students", "progress", "history"} for c in gw.calls)


@pytest.mark.parametrize("path", READS)
def test_sin_token_es_401(path: str) -> None:
    assert _client(Gw()).get(path).status_code == 401


@pytest.mark.parametrize("path", READS)
@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_el_docente_solo_lee(path: str, method: str) -> None:
    response = getattr(_client(Gw()), method)(path, headers=_t())
    assert response.status_code == 405


@pytest.mark.parametrize("path", READS)
def test_con_la_base_caida_responde_503(path: str) -> None:
    gw = Gw(fail={"students", "progress", "history"})
    assert _client(gw).get(path, headers=_t()).status_code == 503


def test_ni_apodos_ni_ids_de_alumnos_llegan_a_los_logs(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client = _client(Gw(fail={"history"}))
    for path in READS:
        client.get(path, headers=_t())
    assert "Ana" not in caplog.text and str(STUDENT) not in caplog.text


# ------------------------------------------------------------------ T5 (tutor)


def _tutor(pin: bool = True, **claims: Any) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {_hs256(sub=str(TUTOR), **claims)}"}
    if pin:
        headers["X-Parental-Token"] = issue_parental_token(SIGN.encode(), TUTOR, now=time.time())
    return headers


def test_el_tutor_ve_el_historial_de_su_hijo_con_hora() -> None:
    response = _client(Gw()).get(f"/v1/students/{STUDENT}/history", headers=_tutor())
    assert response.status_code == 200
    data = response.json()
    assert [i["label"] for i in data["items"]] == ["Contar de 2, 5, 10 y 100", "Tareas del tutor"]
    assert data["items"][0]["answered_at"].startswith("2026-11-12T15:30")
    assert data["items"][1]["tutor_task"] is True
    assert set(data["items"][0]) == {"label", "tutor_task", "correct", "level", "answered_at"}
    assert data["has_more"] is False and data["next_offset"] is None
    assert response.headers["cache-control"] == "no-store"


def test_el_historial_del_tutor_es_zona_del_tutor_pide_el_pin() -> None:
    assert (
        _client(Gw()).get(f"/v1/students/{STUDENT}/history", headers=_tutor(pin=False)).status_code
        == 401
    )


def test_el_historial_del_tutor_en_un_perfil_ajeno_es_403() -> None:
    assert _client(Gw()).get(f"/v1/students/{UNKNOWN}/history", headers=_tutor()).status_code == 403
    assert (
        _client(Gw(tutor_page=None))
        .get(f"/v1/students/{STUDENT}/history", headers=_tutor())
        .status_code
        == 403
    )


def test_un_docente_no_entra_al_historial_del_tutor() -> None:
    headers = {"Authorization": f"Bearer {_hs256(sub=str(TEACHER), **TEACHER_CLAIMS)}"}
    assert _client(Gw()).get(f"/v1/students/{STUDENT}/history", headers=headers).status_code == 403


@pytest.mark.parametrize("query", ["limit=0", "limit=51", "offset=-1"])
def test_historial_del_tutor_valida_la_paginacion(query: str) -> None:
    assert (
        _client(Gw()).get(f"/v1/students/{STUDENT}/history?{query}", headers=_tutor()).status_code
        == 422
    )
