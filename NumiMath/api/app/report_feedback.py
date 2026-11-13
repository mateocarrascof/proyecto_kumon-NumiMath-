"""Feedback para el ADULTO a partir de las estadísticas del perfil.

Frases fijas elegidas por reglas (sin IA): predecibles, gratis y sin enviar nada a terceros.
Tono para adultos, sin culpar al niño ni compararlo con otros. Tabla completa de reglas:
docs/SPEC.md ("Informe y feedback para el adulto").
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

MIN_ATTEMPTS = 5  # intentos mínimos para opinar sobre un tema o una semana
STRONG_PCT = 70  # desde aquí un tema cuenta como fortaleza; por debajo, como tema a reforzar
LOW_DAYS = 3  # menos de esto en 7 días = poca constancia
HIGH_DAYS = 5  # desde aquí = buena constancia
TREND_POINTS = 10  # diferencia de % entre semanas para comentar la tendencia

Kind = Literal["info", "strength", "improve", "habit", "trend"]


@dataclass(frozen=True)
class TopicStat:
    label: str
    total: int
    correct: int


@dataclass(frozen=True)
class WeekStat:
    total: int
    correct: int


@dataclass(frozen=True)
class Feedback:
    kind: Kind
    text: str


def percent(correct: int, total: int) -> int:
    return round(100 * correct / total) if total else 0


def _days(n: int) -> str:
    return "1 día" if n == 1 else f"{n} días"


def build_feedback(
    total: int,
    topics: Sequence[TopicStat],
    practice_days_last_7: int,
    weeks: Sequence[WeekStat],
) -> list[Feedback]:
    """`weeks` va de la más antigua a la más reciente (la última es la semana actual)."""
    if total < MIN_ATTEMPTS:
        missing = MIN_ATTEMPTS - max(total, 0)
        count = "Falta 1" if missing == 1 else f"Faltan {missing}"
        return [
            Feedback(
                "info",
                f"Aún hay pocos ejercicios. {count} para sacar conclusiones. ¡Anímalo a practicar!",
            )
        ]

    out: list[Feedback] = []
    rated = [t for t in topics if t.total >= MIN_ATTEMPTS]
    # Orden estable: mayor % primero; a igual %, el que tiene más intentos.
    by_pct = sorted(rated, key=lambda t: (-percent(t.correct, t.total), -t.total, t.label))

    strong = (
        by_pct[0] if by_pct and percent(by_pct[0].correct, by_pct[0].total) >= STRONG_PCT else None
    )
    if strong:
        out.append(
            Feedback(
                "strength",
                f"Su punto fuerte es {strong.label} "
                f"({percent(strong.correct, strong.total)} % de aciertos).",
            )
        )

    weak = by_pct[-1] if by_pct else None
    if weak and weak is not strong and percent(weak.correct, weak.total) < STRONG_PCT:
        out.append(
            Feedback(
                "improve",
                f"Le conviene practicar más {weak.label} "
                f"({percent(weak.correct, weak.total)} % de aciertos).",
            )
        )

    if practice_days_last_7 < LOW_DAYS:
        out.append(
            Feedback(
                "habit",
                f"Practicó {_days(practice_days_last_7)} esta semana: "
                "unos 10 minutos diarios ayudan mucho.",
            )
        )
    elif practice_days_last_7 >= HIGH_DAYS:
        out.append(
            Feedback(
                "habit",
                f"¡Practicó {_days(practice_days_last_7)} esta semana! La constancia se nota.",
            )
        )

    if len(weeks) >= 2:
        prev, cur = weeks[-2], weeks[-1]
        if prev.total >= MIN_ATTEMPTS and cur.total >= MIN_ATTEMPTS:
            before, now = percent(prev.correct, prev.total), percent(cur.correct, cur.total)
            if now >= before + TREND_POINTS:
                out.append(
                    Feedback("trend", f"Esta semana mejoró: de {before} % a {now} % de aciertos.")
                )
            elif now <= before - TREND_POINTS:
                out.append(
                    Feedback(
                        "trend",
                        f"Esta semana le costó más (de {before} % a {now} %). "
                        "Repasar con calma puede ayudar.",
                    )
                )
    return out
