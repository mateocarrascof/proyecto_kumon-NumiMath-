"""Catálogo de habilidades de 1° a 4° básico.

Fuente: `docs/habilidades_1a4_basico.csv` (copiado aquí como `habilidades.csv`; un test exige que
sean idénticos). No se inventan códigos de habilidad ni de objetivos de aprendizaje: todo sale del
CSV. Reglas y criterios: docs/MAPA_CURRICULAR_MATEMATICA_1A4.md.

- `code` (p. ej. "3-05") es el identificador estable que viaja en tokens, intentos y explicaciones.
- Solo las habilidades de fase A se practican por ahora (texto + respuesta escrita).
- El alumno ve las de su curso y, como repaso, las de cursos anteriores. Sin candados.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

CSV_PATH = Path(__file__).with_name("habilidades.csv")
PRACTICE_PHASE = "A"


@dataclass(frozen=True)
class Skill:
    order: int
    code: str
    grade: int
    module: str
    name: str
    objective: str
    answer: str
    phase: str
    prereqs: tuple[str, ...]
    levels: tuple[str, str, str]


def _load(path: Path) -> tuple[Skill, ...]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    skills = tuple(
        Skill(
            order=int(row["orden"]),
            code=row["codigo"],
            grade=int(row["curso"]),
            module=row["modulo"],
            name=row["nombre"],
            objective=row["objetivo_aprendizaje"],
            answer=row["respuesta"],
            phase=row["fase"],
            prereqs=tuple(p for p in row["prerrequisitos"].split(",") if p),
            levels=(row["nivel_1"], row["nivel_2"], row["nivel_3"]),
        )
        for row in rows
    )
    codes = [s.code for s in skills]
    if len(set(codes)) != len(codes):
        raise ValueError("habilidades.csv: códigos repetidos")
    return tuple(sorted(skills, key=lambda s: s.order))


SKILLS: tuple[Skill, ...] = _load(CSV_PATH)
_BY_CODE: dict[str, Skill] = {s.code: s for s in SKILLS}


def get_skill(code: str) -> Skill | None:
    return _BY_CODE.get(code)


def practice_skills(grade: int) -> tuple[Skill, ...]:
    """Habilidades que el alumno puede practicar: fase A de su curso y de cursos anteriores.

    Primero las de su curso, luego las de repaso (del curso más cercano al más lejano).
    """
    if not 1 <= grade <= 4:
        return ()
    own = [s for s in SKILLS if s.phase == PRACTICE_PHASE and s.grade == grade]
    review = [s for s in SKILLS if s.phase == PRACTICE_PHASE and s.grade < grade]
    review.sort(key=lambda s: (-s.grade, s.order))
    return (*own, *review)


def is_practice_skill(grade: int, code: str) -> bool:
    skill = _BY_CODE.get(code)
    return (
        skill is not None
        and skill.phase == PRACTICE_PHASE
        and 1 <= grade <= 4
        and skill.grade <= grade
    )
