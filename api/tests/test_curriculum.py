"""Catálogo curricular: fuente única y cobertura de generadores."""

from __future__ import annotations

from pathlib import Path

from app.curriculum.catalog import CSV_PATH, SKILLS, get_skill, practice_skills
from app.exercises.generators import GENERATORS

DOCS_CSV = Path(__file__).resolve().parents[2] / "docs" / "habilidades_1a4_basico.csv"


def test_el_csv_de_la_api_es_copia_exacta_del_de_docs() -> None:
    # No se inventan códigos de habilidad ni de OA: la API usa el mismo archivo que docs/.
    assert CSV_PATH.read_bytes() == DOCS_CSV.read_bytes()


def test_el_catalogo_tiene_las_101_habilidades() -> None:
    assert len(SKILLS) == 101
    assert len({s.code for s in SKILLS}) == 101
    fases = [s.phase for s in SKILLS]
    assert (fases.count("A"), fases.count("B"), fases.count("C")) == (54, 30, 17)


def test_cada_habilidad_de_fase_a_tiene_generador_y_ninguna_otra() -> None:
    fase_a = {s.code for s in SKILLS if s.phase == "A"}
    assert set(GENERATORS) == fase_a


def test_los_prerrequisitos_existen() -> None:
    for skill in SKILLS:
        for code in skill.prereqs:
            assert get_skill(code) is not None, (skill.code, code)


def test_practice_skills_su_curso_primero_y_luego_repaso() -> None:
    skills = practice_skills(2)
    assert all(s.phase == "A" for s in skills)
    grados = [s.grade for s in skills]
    assert grados == sorted(grados, key=lambda g: (g != 2, -g))
    assert practice_skills(0) == () and practice_skills(5) == ()
