"""Progreso: resumen, aislamiento entre tutores y falla cerrado."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, date, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import AttemptRow, GatewayError
from app.main import create_app
from app.routes.progress import summarize
from app.weekly import weekly
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
AHORA = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


def _jwt(sub: uuid.UUID = TUTOR) -> str:
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _attempt(minutes_ago: int, topic: str, correct: bool) -> AttemptRow:
    return AttemptRow(topic, correct, AHORA - timedelta(minutes=minutes_ago))


def _client(gateway: FakeGateway) -> TestClient:
    settings = Settings(
        _env_file=None, app_env="test", supabase_url=URL, supabase_jwt_secret=SECRET
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def test_resumen_con_racha_y_aciertos_por_tema() -> None:
    attempts = [  # del más reciente al más antiguo
        _attempt(1, "sumas_hasta_20", True),
        _attempt(2, "sumas_hasta_20", True),
        _attempt(3, "restas_hasta_20", False),
        _attempt(4, "sumas_hasta_20", True),
    ]
    result = summarize(attempts, 1)
    assert (result.total, result.correct, result.streak) == (4, 3, 2)
    assert result.by_topic[0].topic == "sumas_hasta_20"
    assert (result.by_topic[0].total, result.by_topic[0].correct) == (3, 3)
    assert result.by_topic[0].label == "Sumas hasta 20"
    assert len(result.recent) == 4


def test_sin_intentos_todo_en_cero() -> None:
    result = summarize([], 1)
    assert (result.total, result.correct, result.streak) == (0, 0, 0)
    assert result.by_topic == [] and result.recent == []


def test_los_recientes_se_limitan_a_diez() -> None:
    attempts = [_attempt(i, "sumas_hasta_20", True) for i in range(25)]
    assert len(summarize(attempts, 1).recent) == 10


def test_ruta_devuelve_el_progreso_del_perfil_propio() -> None:
    gateway = FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok"},
        grades={(TUTOR, PERFIL): 1},
        attempt_rows={PERFIL: [_attempt(1, "sumas_hasta_20", True)]},
    )
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/progress", headers={"Authorization": f"Bearer {_jwt()}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1 and body["streak"] == 1
    # Ni el apodo ni ningún identificador del perfil viajan en el resumen.
    assert "nickname" not in str(body) and str(PERFIL) not in str(body)


def test_otro_tutor_no_ve_el_progreso_de_un_perfil_ajeno() -> None:
    gateway = FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok"},
        grades={(TUTOR, PERFIL): 1},
        attempt_rows={PERFIL: [_attempt(1, "sumas_hasta_20", True)]},
    )
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/progress", headers={"Authorization": f"Bearer {_jwt(OTRO)}"}
    )
    assert response.status_code == 403


def test_si_la_base_falla_se_deniega() -> None:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"}, grades={(TUTOR, PERFIL): 1})
    gateway.record_error = GatewayError("transport")
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/progress", headers={"Authorization": f"Bearer {_jwt()}"}
    )
    assert response.status_code == 503


def test_sin_token_es_401() -> None:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"})
    assert _client(gateway).get(f"/v1/students/{PERFIL}/progress").status_code == 401


# ---- evolución por semana (CU-A23) -----------------------------------------------------------

HOY = date(2026, 10, 15)


def _on(day: date, correct: bool = True) -> AttemptRow:
    return AttemptRow("1-06", correct, datetime(day.year, day.month, day.day, 15, 0, tzinfo=UTC))


def test_agrupa_por_semana_en_tres_semanas_distintas() -> None:
    attempts = [
        _on(HOY),  # semana actual
        _on(HOY - timedelta(days=6), correct=False),  # misma semana (6 días atrás)
        _on(HOY - timedelta(days=7)),  # semana anterior
        _on(HOY - timedelta(days=30)),
        _on(HOY - timedelta(days=31), correct=False),
    ]
    weeks = weekly(attempts, HOY)
    assert len(weeks) == 8
    assert weeks[-1].start == HOY - timedelta(days=6)
    assert (weeks[-1].total, weeks[-1].correct) == (2, 1)
    assert (weeks[-2].total, weeks[-2].correct) == (1, 1)
    # 30 y 31 días atrás caen en la misma semana (la 5.ª contando desde hoy).
    assert (weeks[3].total, weeks[3].correct) == (2, 1)
    assert sum(w.total for w in weeks) == 5


def test_las_semanas_vacias_vienen_con_cero() -> None:
    weeks = weekly([_on(HOY)], HOY)
    assert [w.total for w in weeks] == [0, 0, 0, 0, 0, 0, 0, 1]
    assert weeks[0].start == HOY - timedelta(days=55)
    assert all(w.total == 0 for w in weekly([], HOY))


def test_la_ventana_es_de_56_dias_que_terminan_hoy() -> None:
    weeks = weekly([_on(HOY - timedelta(days=56)), _on(HOY - timedelta(days=55))], HOY)
    assert sum(w.total for w in weeks) == 1
    assert weeks[0].total == 1


def test_la_ruta_entrega_las_8_semanas_con_la_fecha_local() -> None:
    today = datetime.now(UTC).date()
    gateway = FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok"},
        grades={(TUTOR, PERFIL): 1},
        attempt_rows={PERFIL: [_on(today), _on(today - timedelta(days=8), correct=False)]},
    )
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/progress",
        params={"today": today.isoformat()},
        headers={"Authorization": f"Bearer {_jwt()}"},
    )
    assert response.status_code == 200
    weeks = response.json()["weeks"]
    assert len(weeks) == 8
    assert weeks[-1] == {"start": (today - timedelta(days=6)).isoformat(), "total": 1, "correct": 1}
    assert (weeks[-2]["total"], weeks[-2]["correct"]) == (1, 0)


def test_una_fecha_no_creible_usa_la_de_utc() -> None:
    today = datetime.now(UTC).date()
    gateway = FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok"},
        grades={(TUTOR, PERFIL): 1},
        attempt_rows={PERFIL: [_on(today)]},
    )
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/progress",
        params={"today": "2020-01-01"},
        headers={"Authorization": f"Bearer {_jwt()}"},
    )
    assert response.json()["weeks"][-1]["total"] == 1


def test_cada_perfil_ve_solo_su_evolucion() -> None:
    otro_perfil = uuid.UUID("22222222-bbbb-0000-0000-000000000002")
    today = datetime.now(UTC).date()
    gateway = FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok", (OTRO, otro_perfil): "ok"},
        grades={(TUTOR, PERFIL): 1, (OTRO, otro_perfil): 1},
        attempt_rows={PERFIL: [_on(today)], otro_perfil: [_on(today)] * 7},
    )
    client = _client(gateway)
    mio = client.get(
        f"/v1/students/{PERFIL}/progress", headers={"Authorization": f"Bearer {_jwt()}"}
    ).json()
    assert sum(w["total"] for w in mio["weeks"]) == 1
    # El tutor no puede pedir la evolución de un perfil que no es suyo.
    ajeno = client.get(
        f"/v1/students/{otro_perfil}/progress", headers={"Authorization": f"Bearer {_jwt()}"}
    )
    assert ajeno.status_code == 403
