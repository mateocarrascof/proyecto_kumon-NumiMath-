"""CU-A21: salidas guardadas de los generadores de juegos (ADR 0004, estabilidad).

Si esta prueba falla, un generador cambió: los tokens en vuelo dejarían de verificarse (422) y los
intentos guardados con ese `game_kind` ya no corresponderían al mismo juego. La regla: NO se edita
un juego existente; se crea uno nuevo con otro id (o se sube la versión del token). Solo si el
cambio es intencional y se siguió esa regla, se regeneran estas salidas.

También detecta un cambio en `random` al subir de versión de Python.
"""

from __future__ import annotations

import uuid

import pytest

from app.exercises.games import GAMES
from app.exercises.tokens import _rng

KEY = b"clave-fija-solo-para-salidas-guardadas"
SEEDS = [uuid.UUID(f"00000000-0000-0000-0000-00000000000{i}") for i in (1, 2, 3)]

GOLDEN = {
    "compara-signo-2": [
        ("choice", "¿Qué signo va? 35 __ 42", ("s:mayor", "s:igual", "s:menor"), ("s:menor",)),
        ("choice", "¿Qué signo va? 39 __ 39", ("s:mayor", "s:menor", "s:igual"), ("s:igual",)),
        ("choice", "¿Qué signo va? 58 __ 31", ("s:igual", "s:menor", "s:mayor"), ("s:mayor",)),
    ],
    "cuantos-1": [
        ("choice", "¿Cuántas manzanas hay? 🍎🍎🍎🍎🍎🍎🍎", ("n:6", "n:8", "n:7"), ("n:7",)),
        ("choice", "¿Cuántas manzanas hay? 🍎🍎🍎", ("n:4", "n:3", "n:2"), ("n:3",)),
        ("choice", "¿Cuántas pelotas hay? ⚽⚽⚽⚽⚽", ("n:4", "n:5", "n:7"), ("n:5",)),
    ],
    "donde-hay-mas-1": [
        (
            "choice",
            "¿Dónde hay más?",
            ("e:manzana-5", "e:manzana-6", "e:manzana-3"),
            ("e:manzana-6",),
        ),
        (
            "choice",
            "¿Dónde hay más?",
            ("e:manzana-4", "e:manzana-2", "e:manzana-1"),
            ("e:manzana-4",),
        ),
        ("choice", "¿Dónde hay más?", ("e:pelota-6", "e:pelota-5", "e:pelota-2"), ("e:pelota-6",)),
    ],
    "mayor-1": [
        ("choice", "¿Cuál es el número mayor?", ("n:11", "n:8", "n:10"), ("n:11",)),
        ("choice", "¿Cuál es el número mayor?", ("n:9", "n:3", "n:7"), ("n:9",)),
        ("choice", "¿Cuál es el número mayor?", ("n:7", "n:18", "n:14"), ("n:18",)),
    ],
    "mayor-2": [
        ("choice", "¿Cuál es el número mayor?", ("n:44", "n:35", "n:41"), ("n:44",)),
        ("choice", "¿Cuál es el número mayor?", ("n:39", "n:14", "n:28"), ("n:39",)),
        ("choice", "¿Cuál es el número mayor?", ("n:31", "n:75", "n:58"), ("n:75",)),
    ],
    "ordena-1": [
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:11", "n:8", "n:20", "n:10"),
            ("n:8", "n:10", "n:11", "n:20"),
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:14", "n:7", "n:3", "n:9"),
            ("n:3", "n:7", "n:9", "n:14"),
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:18", "n:14", "n:7", "n:6"),
            ("n:6", "n:7", "n:14", "n:18"),
        ),
    ],
    "ordena-2": [
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:44", "n:35", "n:32", "n:41"),
            ("n:32", "n:35", "n:41", "n:44"),
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:28", "n:14", "n:39", "n:88"),
            ("n:14", "n:28", "n:39", "n:88"),
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:75", "n:58", "n:31", "n:26"),
            ("n:26", "n:31", "n:58", "n:75"),
        ),
    ],
    "que-sigue-1": [
        ("choice", "¿Qué número sigue? 4, 6, 8, …", ("n:12", "n:11", "n:10"), ("n:10",)),
        ("choice", "¿Qué número sigue? 0, 2, 4, …", ("n:7", "n:6", "n:8"), ("n:6",)),
        ("choice", "¿Qué número sigue? 8, 10, 12, …", ("n:12", "n:14", "n:16"), ("n:14",)),
    ],
    "que-sigue-2": [
        ("choice", "¿Qué número sigue? 40, 45, 50, …", ("n:60", "n:56", "n:55"), ("n:55",)),
        ("choice", "¿Qué número sigue? 10, 15, 20, …", ("n:26", "n:25", "n:30"), ("n:25",)),
        ("choice", "¿Qué número sigue? 75, 80, 85, …", ("n:85", "n:90", "n:95"), ("n:90",)),
    ],
}


def test_estan_todos_los_juegos_del_catalogo() -> None:
    # Un juego nuevo debe agregar sus salidas guardadas aquí.
    assert set(GOLDEN) == set(GAMES)


@pytest.mark.parametrize("game_id", sorted(GOLDEN))
def test_el_generador_no_cambio(game_id: str) -> None:
    for seed, expected in zip(SEEDS, GOLDEN[game_id], strict=True):
        exercise = GAMES[game_id].make(_rng(KEY, seed))
        got = (
            exercise.kind,
            exercise.text,
            tuple(o.id for o in exercise.options),
            exercise.solution,
        )
        assert got == expected, f"{game_id} cambió con la semilla {seed}"
