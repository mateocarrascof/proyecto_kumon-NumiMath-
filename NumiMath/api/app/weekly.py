"""Intentos agrupados por semana: lo usan el informe del tutor y "Mi progreso" del niño (CU-A23).

Vive aparte de las rutas porque `report.py` ya importa de `progress.py`: así ambas lo comparten
sin un import circular. Recibe solo intentos de PRÁCTICA (`list_attempts` excluye el diagnóstico).
"Hoy" es la fecha local del dispositivo (validada como en la racha); la fecha de cada intento, UTC.
"""

from __future__ import annotations

from datetime import UTC, date, timedelta

from pydantic import BaseModel

from app.db.gateway import AttemptRow

WEEKS = 8


class WeekOut(BaseModel):
    start: date
    total: int
    correct: int


def attempt_day(attempt: AttemptRow) -> date:
    at = attempt.answered_at
    return (at.astimezone(UTC) if at.tzinfo else at).date()


def local_attempt_day(attempt: AttemptRow, today: date) -> date:
    """Día del intento comparable con `today` (la fecha LOCAL del dispositivo).

    El intento se fecha en UTC. En Chile (UTC−3/−4) lo que el niño practica de noche (después de
    las 20–21 h) ya es "mañana" en UTC: sin este ajuste quedaría fuera de la semana actual y no
    se vería en el gráfico. Se acepta `today + 1` como hoy: la misma tolerancia de ±1 día con la
    que se valida la fecha del dispositivo (`parse_local_day`). Sin la zona horaria (que no se
    guarda) no se puede ser más exacto: un intento de la noche anterior puede caer un día después.
    """
    day = attempt_day(attempt)
    return today if day == today + timedelta(days=1) else day


def weekly(attempts: list[AttemptRow], today: date, weeks: int = WEEKS) -> list[WeekOut]:
    """`weeks` periodos de 7 días que terminan `today`, del más antiguo al más reciente.

    Siempre devuelve todos los periodos, también los vacíos (0): el gráfico muestra las semanas
    sin práctica como un hueco, no las salta."""
    first = today - timedelta(days=7 * weeks - 1)
    buckets = [[0, 0] for _ in range(weeks)]
    for a in attempts:
        day = local_attempt_day(a, today)
        if first <= day <= today:
            bucket = buckets[(day - first).days // 7]
            bucket[0] += 1
            bucket[1] += 1 if a.correct else 0
    return [
        WeekOut(start=first + timedelta(days=7 * i), total=t, correct=c)
        for i, (t, c) in enumerate(buckets)
    ]
