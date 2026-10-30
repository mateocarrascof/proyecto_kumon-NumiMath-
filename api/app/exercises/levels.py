"""Dominio por habilidad: 3 niveles (1 fácil, 2 medio, 3 difícil) y bloques de 10 ejercicios.

Regla (docs/SPEC.md, "Catálogo curricular: decisiones sobre el mapa"):
- cada habilidad avanza en bloques de 10 ejercicios en el mismo nivel;
- al completar el bloque: 8 o más aciertos sube un nivel (en el nivel 3, la habilidad queda
  dominada); 4 o menos baja un nivel (mínimo 1); 5 a 7 repite el nivel;
- el bloque se llena aunque el niño cambie de día; al cambiar de nivel empieza uno nuevo;
- un ejercicio emitido en otro nivel (antes de un cambio) no cuenta para el bloque.

La fuente de verdad es la base: `record_attempt` aplica esta regla en la misma transacción
(supabase/migrations/20261028100000_skill_progress.sql). `apply_answer` la repite en Python para
los dobles de prueba y para documentarla con tests; si cambia una, cambia la otra.
"""

from __future__ import annotations

from dataclasses import dataclass

MIN_LEVEL = 1
MAX_LEVEL = 3
BLOCK_SIZE = 10
LEVEL_UP_AT = 8  # aciertos en el bloque para subir (o dominar en el nivel 3)
LEVEL_DOWN_AT = 4  # aciertos en el bloque o menos para bajar


def clamp_level(level: int) -> int:
    return min(MAX_LEVEL, max(MIN_LEVEL, level))


@dataclass(frozen=True)
class SkillProgress:
    level: int = MIN_LEVEL
    block_total: int = 0  # ejercicios del bloque en curso (0 a 9)
    block_correct: int = 0
    mastered: bool = False


def apply_answer(progress: SkillProgress, level: int, correct: bool) -> SkillProgress:
    """Progreso después de responder un ejercicio emitido en `level`."""
    if level != progress.level:
        return progress
    total = progress.block_total + 1
    right = progress.block_correct + (1 if correct else 0)
    if total < BLOCK_SIZE:
        return SkillProgress(progress.level, total, right, progress.mastered)
    new_level, mastered = progress.level, progress.mastered
    if right >= LEVEL_UP_AT:
        if new_level < MAX_LEVEL:
            new_level += 1
        else:
            mastered = True
    elif right <= LEVEL_DOWN_AT and new_level > MIN_LEVEL:
        new_level -= 1
    return SkillProgress(new_level, 0, 0, mastered)
