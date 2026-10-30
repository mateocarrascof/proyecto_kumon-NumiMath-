"""Regla de dominio por habilidad (función pura; la base aplica la misma en record_attempt)."""

from __future__ import annotations

import pytest

from app.exercises.levels import BLOCK_SIZE, SkillProgress, apply_answer


def _block(progress: SkillProgress, right: int, total: int = BLOCK_SIZE) -> SkillProgress:
    for i in range(total):
        progress = apply_answer(progress, progress.level, i < right)
    return progress


def test_empieza_en_nivel_1_con_el_bloque_vacio() -> None:
    assert SkillProgress() == SkillProgress(1, 0, 0, False)


def test_el_bloque_se_llena_de_a_uno() -> None:
    p = _block(SkillProgress(), 3, 4)
    assert (p.level, p.block_total, p.block_correct) == (1, 4, 3)


@pytest.mark.parametrize(
    ("level", "right", "expected"),
    [
        (1, 10, 2),
        (1, 8, 2),  # 8 de 10 sube
        (1, 7, 1),  # 7 repite
        (2, 5, 2),  # 5 repite
        (2, 4, 1),  # 4 baja
        (2, 0, 1),
        (1, 0, 1),  # piso
        (3, 10, 3),  # techo
        (3, 4, 2),
    ],
)
def test_al_completar_el_bloque(level: int, right: int, expected: int) -> None:
    p = _block(SkillProgress(level=level), right)
    assert p.level == expected
    assert (p.block_total, p.block_correct) == (0, 0)  # empieza un bloque nuevo


def test_dominar_es_8_o_mas_en_el_nivel_3() -> None:
    p = _block(SkillProgress(level=2), 9)
    assert p.level == 3 and not p.mastered
    p = _block(p, 7)
    assert not p.mastered
    p = _block(p, 8)
    assert p.mastered and p.level == 3
    # Dominada queda dominada aunque después le vaya mal.
    assert _block(p, 2).mastered


def test_un_ejercicio_de_otro_nivel_no_cuenta() -> None:
    p = SkillProgress(level=2, block_total=3, block_correct=3)
    assert apply_answer(p, 1, True) == p
