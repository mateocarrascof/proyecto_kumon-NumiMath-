"""Progreso: resumen, aislamiento entre tutores y falla cerrado."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import AttemptRow, GatewayError
from app.main import create_app
from app.routes.progress import summarize
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
