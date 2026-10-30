"""Racha diaria ("días seguidos") de un perfil.

La fecha la pone el dispositivo (hora local del niño), pero el servidor solo la acepta si está a
un día como máximo de la fecha UTC: eso cubre todas las zonas horarias (UTC−12 a UTC+14) y acota
cuánto se puede ganar cambiando el reloj. La base aplica la misma regla (record_attempt).
Reglas completas: docs/SPEC.md ("Racha diaria").
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

MAX_SKEW = timedelta(days=1)


@dataclass(frozen=True)
class DailyStreakRow:
    """Lo único que se guarda: largo de la racha y último día local practicado."""

    current_len: int
    last_day: date


def utc_today(now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(UTC).date()


def parse_local_day(value: date | None, now: datetime | None = None) -> date | None:
    """Fecha local del dispositivo si es creíble; `None` si falta o está fuera de rango."""
    if value is None:
        return None
    today = utc_today(now)
    if today - MAX_SKEW <= value <= today + MAX_SKEW:
        return value
    return None


def effective_streak(row: DailyStreakRow | None, today: date) -> tuple[int, bool]:
    """(días seguidos, practicó hoy). La racha sigue viva hasta que termina el día siguiente."""
    if row is None or row.last_day < today - timedelta(days=1):
        return 0, False
    return row.current_len, row.last_day >= today
