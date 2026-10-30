"""Informe para el adulto: reglas del feedback, semanas, días practicados y la ruta."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, date, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import AttemptRow, GatewayError
from app.main import create_app
from app.parental import issue_parental_token
from app.report_feedback import TopicStat, WeekStat, build_feedback
from app.routes.report import practice_days, weekly
from app.streaks import utc_today
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
SIGN = "clave-de-firma-de-ejercicios-solo-pruebas"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")


def _kinds(feedback: list) -> list[str]:  # type: ignore[type-arg]
    return [f.kind for f in feedback]


# ---- reglas del feedback -----------------------------------------------------------------


def test_con_pocos_datos_solo_da_un_aviso() -> None:
    out = build_feedback(3, [TopicStat("Sumas", 3, 3)], 1, [])
    assert _kinds(out) == ["info"]
    assert "pocos ejercicios" in out[0].text


def test_punto_fuerte_y_tema_a_reforzar() -> None:
    topics = [TopicStat("Sumas", 10, 9), TopicStat("Restas", 10, 4), TopicStat("Contar", 2, 0)]
    out = build_feedback(22, topics, 3, [])
    texts = {f.kind: f.text for f in out}
    assert texts["strength"] == "Su punto fuerte es Sumas (90 % de aciertos)."
    assert texts["improve"] == "Le conviene practicar más Restas (40 % de aciertos)."


def test_un_tema_con_pocos_intentos_no_cuenta() -> None:
    out = build_feedback(12, [TopicStat("Sumas", 10, 9), TopicStat("Restas", 2, 0)], 3, [])
    assert "improve" not in _kinds(out)


def test_si_todo_va_bien_no_hay_tema_a_reforzar() -> None:
    out = build_feedback(20, [TopicStat("Sumas", 10, 9), TopicStat("Restas", 10, 8)], 3, [])
    assert "improve" not in _kinds(out)


def test_si_todo_cuesta_no_hay_punto_fuerte() -> None:
    out = build_feedback(20, [TopicStat("Sumas", 10, 5), TopicStat("Restas", 10, 3)], 3, [])
    assert "strength" not in _kinds(out)
    assert any("Restas" in f.text for f in out if f.kind == "improve")


def test_un_solo_tema_flojo_se_marca_a_reforzar() -> None:
    out = build_feedback(10, [TopicStat("Sumas", 10, 3)], 3, [])
    assert _kinds(out).count("improve") == 1


def test_constancia_baja_y_alta() -> None:
    low = build_feedback(10, [], 1, [])
    assert [f.text for f in low if f.kind == "habit"] == [
        "Practicó 1 día esta semana: unos 10 minutos diarios ayudan mucho."
    ]
    high = build_feedback(10, [], 6, [])
    assert "¡Practicó 6 días esta semana!" in high[0].text
    assert "habit" not in _kinds(build_feedback(10, [], 4, []))


def test_tendencia_semanal() -> None:
    up = build_feedback(20, [], 4, [WeekStat(10, 6), WeekStat(10, 8)])
    assert [f.text for f in up if f.kind == "trend"] == [
        "Esta semana mejoró: de 60 % a 80 % de aciertos."
    ]
    down = build_feedback(20, [], 4, [WeekStat(10, 8), WeekStat(10, 6)])
    assert "le costó más" in next(f.text for f in down if f.kind == "trend")
    flat = build_feedback(20, [], 4, [WeekStat(10, 7), WeekStat(10, 7)])
    assert "trend" not in _kinds(flat)
    few = build_feedback(20, [], 4, [WeekStat(2, 0), WeekStat(10, 10)])
    assert "trend" not in _kinds(few)


# ---- semanas y días ----------------------------------------------------------------------


def _at(day: date, correct: bool = True) -> AttemptRow:
    return AttemptRow("1-08", correct, datetime(day.year, day.month, day.day, 12, tzinfo=UTC))


def test_semanas_terminan_hoy_y_van_de_la_mas_antigua_a_la_actual() -> None:
    today = date(2026, 10, 26)
    attempts = [
        _at(today),
        _at(today - timedelta(days=6), correct=False),
        _at(today - timedelta(days=7)),
        _at(today - timedelta(days=55)),
        _at(today - timedelta(days=56)),  # fuera de las 8 semanas
    ]
    weeks = weekly(attempts, today)
    assert len(weeks) == 8
    assert weeks[-1].start == today - timedelta(days=6)
    assert (weeks[-1].total, weeks[-1].correct) == (2, 1)
    assert (weeks[-2].total, weeks[-2].correct) == (1, 1)
    assert weeks[0].start == today - timedelta(days=55)
    assert weeks[0].total == 1


def test_dias_practicados_distintos_en_7_dias() -> None:
    today = date(2026, 10, 26)
    attempts = [_at(today), _at(today), _at(today - timedelta(days=3)), _at(today - timedelta(7))]
    assert practice_days(attempts, today) == 2


# ---- ruta --------------------------------------------------------------------------------


def _client(gateway: FakeGateway) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=SIGN,
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _headers() -> dict[str, str]:
    claims = {
        "sub": str(TUTOR),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    return {
        "Authorization": f"Bearer {jwt.encode(claims, SECRET, algorithm='HS256')}",
        "X-Parental-Token": issue_parental_token(SIGN.encode(), TUTOR),
    }


def test_la_ruta_devuelve_resumen_semanas_temas_y_feedback() -> None:
    today = utc_today()
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"}, grades={(TUTOR, PERFIL): 1})
    gateway.attempt_rows[PERFIL] = [_at(today, correct=i < 8) for i in range(10)] + [
        AttemptRow("tarea_tutor", True, datetime.now(UTC))
    ]
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/report?today={today.isoformat()}", headers=_headers()
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["correct"], body["percent"]) == (11, 9, 82)
    assert body["practice_days_last_7"] == 1
    assert len(body["weeks"]) == 8 and body["weeks"][-1]["total"] == 11
    labels = {t["label"] for t in body["by_topic"]}
    assert labels == {"Sumas hasta 20", "Tareas del tutor"}
    assert any(f["kind"] == "strength" for f in body["feedback"])


def test_la_ruta_falla_cerrado_si_la_base_falla() -> None:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"}, grades={(TUTOR, PERFIL): 1})
    gateway.record_error = GatewayError("transport")
    response = _client(gateway).get(f"/v1/students/{PERFIL}/report", headers=_headers())
    assert response.status_code == 503


def test_el_informe_pide_el_pin() -> None:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"}, grades={(TUTOR, PERFIL): 1})
    headers = {"Authorization": _headers()["Authorization"]}
    response = _client(gateway).get(f"/v1/students/{PERFIL}/report", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "parental_required"
