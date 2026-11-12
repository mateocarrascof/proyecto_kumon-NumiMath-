"""Diagnóstico inicial de una habilidad (CU-A2): regla del nivel de entrada.

La prueba tiene SIEMPRE 6 ejercicios: 2 de nivel 1, 2 de nivel 2 y 2 de nivel 3, en ese orden.
No se corta cuando el niño falla: así la prueba dura lo mismo para todos y no se siente como un
examen que "se pierde".
"""

from __future__ import annotations

from collections.abc import Sequence

from app.exercises.levels import MAX_LEVEL, MIN_LEVEL

STEPS = 6
PER_LEVEL = 2


def level_for_step(step: int) -> int:
    """Nivel del ejercicio de cada paso (0–1 → 1, 2–3 → 2, 4–5 → 3). Lo decide el servidor."""
    if not 0 <= step < STEPS:
        raise ValueError("step")
    return step // PER_LEVEL + MIN_LEVEL


def entry_level(correct_by_step: Sequence[bool]) -> int:
    """Nivel de entrada: el nivel MÁS ALTO en que acertó los 2 ejercicios, con mínimo 1.

    No se suma uno (acertar el nivel 2 y fallar el 3 parte en nivel 2) y el tope es 3. El
    diagnóstico nunca deja la habilidad "dominada": eso exige un bloque de práctica en nivel 3.
    """
    if len(correct_by_step) != STEPS:
        raise ValueError("steps")
    level = MIN_LEVEL
    for candidate in range(MIN_LEVEL, MAX_LEVEL + 1):
        first = (candidate - MIN_LEVEL) * PER_LEVEL
        if all(correct_by_step[first : first + PER_LEVEL]):
            level = candidate
    return level
