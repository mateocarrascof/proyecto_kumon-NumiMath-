"""Lote de ejercicios para practicar sin conexión (CU-A12, ADR 0002, opción A).

Qué se entrega por ejercicio:
- el token firmado del lote (dominio `offline-token|`, ver `tokens.py`): NO lleva la respuesta;
  al sincronizar (CU-A13) el servidor la regenera desde el token y corrige de nuevo;
- el enunciado, el tema y el nivel (los mismos que van firmados en el token);
- la solución como `SHA-256(sal del lote | forma canónica)`, solo para que la app muestre una
  corrección PROVISIONAL sin internet.

El hash NO es una barrera de seguridad: las respuestas son números chicos y se pueden probar
todos. Solo evita que la solución se lea a simple vista en el almacenamiento del navegador. Lo
que cuenta (intentos, nivel, racha) lo decide el servidor al sincronizar; el "acertó" del
dispositivo se ignora. Riesgo aceptado en el ADR 0002 (la app no tiene premios ni notas).
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from math import gcd

from app.exercises.generators import Exercise
from app.exercises.levels import MAX_LEVEL, MIN_LEVEL
from app.exercises.tokens import issue

# Intentos por ejercicio para no repetir enunciados dentro de un nivel (como en la práctica).
_FRESH_TRIES = 20


@dataclass(frozen=True)
class OfflineItem:
    token: str
    topic: str
    level: int
    text: str
    is_fraction: bool
    solution_hash: str


def canonical(answer: int, answer_den: int | None) -> str:
    """Forma canónica de una respuesta: "12", o la fracción simplificada "3/5".

    Las fracciones se simplifican porque el servidor acepta las equivalentes (6/10 = 3/5): la
    app simplifica la respuesta del niño antes de compararla.
    """
    if answer_den is None:
        return str(answer)
    common = gcd(answer, answer_den) or 1
    return f"{answer // common}/{answer_den // common}"


def solution_hash(salt: str, exercise: Exercise) -> str:
    text = f"{salt}|{canonical(exercise.answer, exercise.answer_den)}"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def batch_levels(level: int) -> list[int]:
    """Nivel actual y sus vecinos: el niño puede terminar un bloque, subir o bajar y seguir."""
    return [lv for lv in (level - 1, level, level + 1) if MIN_LEVEL <= lv <= MAX_LEVEL]


def build_topic_items(
    key: bytes,
    student_id: uuid.UUID,
    topic: str,
    level: int,
    per_level: int,
    ttl_seconds: int,
    salt: str,
    now: float | None = None,
) -> list[OfflineItem]:
    """Ejercicios del lote para una habilidad: `per_level` por cada nivel de `batch_levels`.

    Dentro de un nivel no se repiten enunciados mientras haya otros posibles; si el nivel tiene
    menos (p. ej. 2 × 1 a 2 × 5), se acepta repetir, igual que en la práctica en línea.
    """
    items: list[OfflineItem] = []
    for lv in batch_levels(level):
        seen: set[str] = set()
        for _ in range(per_level):
            issued = None
            for _ in range(_FRESH_TRIES):
                issued = issue(key, student_id, topic, ttl_seconds, now=now, level=lv, offline=True)
                if issued is None or issued.exercise.text not in seen:
                    break
            if issued is None:
                return []
            seen.add(issued.exercise.text)
            items.append(
                OfflineItem(
                    token=issued.token,
                    topic=topic,
                    level=lv,
                    text=issued.exercise.text,
                    is_fraction=issued.exercise.is_fraction,
                    solution_hash=solution_hash(salt, issued.exercise),
                )
            )
    return items
