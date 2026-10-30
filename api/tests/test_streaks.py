"""Racha diaria: validación de la fecha local, cálculo al leer y paso por las rutas."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.db.gateway import GatewayError
from app.streaks import DailyStreakRow, effective_streak, parse_local_day, utc_today
from tests.fakes import FakeGateway
from tests.test_exercises import OTRO_TUTOR, PERFIL, _client, _gateway, _jwt, _new, _post, _solve

DIA = timedelta(days=1)
HOY = date(2026, 10, 26)


# ---------- parse_local_day ----------


def test_acepta_hoy_ayer_y_manana_respecto_de_utc() -> None:
    now = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)
    for value in (HOY - DIA, HOY, HOY + DIA):
        assert parse_local_day(value, now) == value


def test_rechaza_fechas_a_mas_de_un_dia_o_ausentes() -> None:
    now = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)
    assert parse_local_day(HOY - 2 * DIA, now) is None
    assert parse_local_day(HOY + 2 * DIA, now) is None
    assert parse_local_day(None, now) is None


def test_cubre_las_zonas_extremas() -> None:
    # 23:30 UTC: en UTC+14 ya es el día siguiente.
    late = datetime(2026, 10, 26, 23, 30, tzinfo=UTC)
    assert parse_local_day(HOY + DIA, late) == HOY + DIA
    # 00:30 UTC: en UTC−12 todavía es el día anterior.
    early = datetime(2026, 10, 26, 0, 30, tzinfo=UTC)
    assert parse_local_day(HOY - DIA, early) == HOY - DIA


# ---------- effective_streak ----------


def test_sin_racha_es_cero() -> None:
    assert effective_streak(None, HOY) == (0, False)


def test_practico_hoy() -> None:
    assert effective_streak(DailyStreakRow(3, HOY), HOY) == (3, True)


def test_practico_ayer_la_racha_sigue_viva_pero_no_cuenta_hoy() -> None:
    assert effective_streak(DailyStreakRow(3, HOY - DIA), HOY) == (3, False)


def test_un_dia_sin_practicar_la_pierde() -> None:
    assert effective_streak(DailyStreakRow(3, HOY - 2 * DIA), HOY) == (0, False)


def test_ultimo_dia_en_el_futuro_cuenta_como_hoy() -> None:
    # El dispositivo cruzó la medianoche antes que el "hoy" que manda ahora (zonas distintas).
    assert effective_streak(DailyStreakRow(2, HOY + DIA), HOY) == (2, True)


# ---------- rutas ----------


def _answer(client, gateway: FakeGateway, local_date: str | None) -> int:  # type: ignore[no-untyped-def]
    exercise = _new(client).json()
    body: dict[str, object] = {"token": exercise["token"], "answer": _solve(exercise["token"])}
    if local_date is not None:
        body["local_date"] = local_date
    return _post(client, f"/v1/students/{PERFIL}/exercises/answer", body).status_code


def _progress(client, today: date | None = None):  # type: ignore[no-untyped-def]
    params = {"today": today.isoformat()} if today else None
    return client.get(
        f"/v1/students/{PERFIL}/progress",
        params=params,
        headers={"Authorization": f"Bearer {_jwt()}"},
    )


def test_responder_con_fecha_local_inicia_la_racha() -> None:
    gateway = _gateway()
    client = _client(gateway)
    today = utc_today()
    assert _answer(client, gateway, today.isoformat()) == 200
    assert gateway.streaks[PERFIL] == DailyStreakRow(1, today)
    body = _progress(client, today).json()
    assert body["daily_streak"] == 1 and body["practiced_today"] is True


def test_responder_al_dia_siguiente_suma() -> None:
    gateway = _gateway()
    today = utc_today()
    gateway.streaks[PERFIL] = DailyStreakRow(4, today - DIA)
    assert _answer(_client(gateway), gateway, today.isoformat()) == 200
    assert gateway.streaks[PERFIL] == DailyStreakRow(5, today)


def test_fecha_no_creible_registra_el_intento_sin_tocar_la_racha() -> None:
    gateway = _gateway()
    far = (utc_today() + 5 * DIA).isoformat()
    assert _answer(_client(gateway), gateway, far) == 200
    assert len(gateway.attempts) == 1
    assert gateway.local_days == [None]
    assert PERFIL not in gateway.streaks


def test_sin_fecha_local_el_cliente_viejo_sigue_funcionando() -> None:
    gateway = _gateway()
    assert _answer(_client(gateway), gateway, None) == 200
    assert PERFIL not in gateway.streaks


def test_fecha_mal_formada_se_rechaza() -> None:
    gateway = _gateway()
    assert _answer(_client(gateway), gateway, "26-10-2026") == 422
    assert not gateway.attempts


def test_progreso_sin_practicar_ayer_ni_hoy_muestra_cero() -> None:
    gateway = _gateway()
    today = utc_today()
    gateway.streaks[PERFIL] = DailyStreakRow(7, today - 2 * DIA)
    body = _progress(_client(gateway), today).json()
    assert body["daily_streak"] == 0 and body["practiced_today"] is False


def test_progreso_sin_today_usa_la_fecha_utc() -> None:
    gateway = _gateway()
    gateway.streaks[PERFIL] = DailyStreakRow(2, utc_today())
    body = _progress(_client(gateway)).json()
    assert body["daily_streak"] == 2


def test_progreso_falla_cerrado_si_no_se_puede_leer_la_racha() -> None:
    gateway = _gateway()
    gateway.streak_error = GatewayError("transport")
    assert _progress(_client(gateway)).status_code == 503


def test_la_racha_de_otro_tutor_no_se_ve() -> None:
    gateway = _gateway()
    gateway.streaks[PERFIL] = DailyStreakRow(9, utc_today())
    response = _client(gateway).get(
        f"/v1/students/{PERFIL}/progress",
        headers={"Authorization": f"Bearer {_jwt(OTRO_TUTOR)}"},
    )
    assert response.status_code == 403
