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
        (
            "choice",
            "¿Qué signo va? 35 __ 42",
            ("s:mayor", "s:igual", "s:menor"),
            ("s:menor",),
            None,
        ),
        (
            "choice",
            "¿Qué signo va? 39 __ 39",
            ("s:mayor", "s:menor", "s:igual"),
            ("s:igual",),
            None,
        ),
        (
            "choice",
            "¿Qué signo va? 58 __ 31",
            ("s:igual", "s:menor", "s:mayor"),
            ("s:mayor",),
            None,
        ),
    ],
    "completa-camino-1": [
        (
            "fill",
            "Completa el camino: de 5 en 5.",
            ("n:50", "n:55", "n:60", "n:75", "n:77", "n:70", "n:65", "n:56"),
            ("n:50", "n:55", "n:60", "n:65", "n:70", "n:75"),
            ("n:50", "n:55", "n:60", None, None, "n:75"),
        ),
        (
            "fill",
            "Completa el camino: de 5 en 5.",
            ("n:15", "n:20", "n:25", "n:40", "n:30", "n:29", "n:35", "n:14"),
            ("n:15", "n:20", "n:25", "n:30", "n:35", "n:40"),
            ("n:15", "n:20", "n:25", None, None, "n:40"),
        ),
        (
            "fill",
            "Completa el camino: de 10 en 10.",
            ("n:40", "n:50", "n:80", "n:90", "n:89", "n:66", "n:70", "n:60"),
            ("n:40", "n:50", "n:60", "n:70", "n:80", "n:90"),
            ("n:40", "n:50", None, None, "n:80", "n:90"),
        ),
    ],
    "cuantos-1": [
        ("choice", "¿Cuántas manzanas hay? 🍎🍎🍎🍎🍎🍎🍎", ("n:6", "n:8", "n:7"), ("n:7",), None),
        ("choice", "¿Cuántas manzanas hay? 🍎🍎🍎", ("n:4", "n:3", "n:2"), ("n:3",), None),
        ("choice", "¿Cuántas pelotas hay? ⚽⚽⚽⚽⚽", ("n:4", "n:5", "n:7"), ("n:5",), None),
    ],
    "descompone-1": [
        ("choice", "8 = 3 + ? 🍎🍎🍎", ("n:3", "n:5", "n:6"), ("n:5",), None),
        ("choice", "4 = 1 + ? 🍎", ("n:3", "n:1", "n:5"), ("n:3",), None),
        ("choice", "6 = 2 + ? ⚽⚽", ("n:5", "n:6", "n:4"), ("n:4",), None),
    ],
    "donde-hay-mas-1": [
        (
            "choice",
            "¿Dónde hay más?",
            ("e:manzana-5", "e:manzana-6", "e:manzana-3"),
            ("e:manzana-6",),
            None,
        ),
        (
            "choice",
            "¿Dónde hay más?",
            ("e:manzana-4", "e:manzana-2", "e:manzana-1"),
            ("e:manzana-4",),
            None,
        ),
        (
            "choice",
            "¿Dónde hay más?",
            ("e:pelota-6", "e:pelota-5", "e:pelota-2"),
            ("e:pelota-6",),
            None,
        ),
    ],
    "junta-1": [
        (
            "choice",
            "Junta las manzanas. ¿Cuántas hay? 🍎🍎🍎🍎🍎🍎 🍎🍎🍎🍎🍎🍎",
            ("n:10", "n:12", "n:13"),
            ("n:12",),
            None,
        ),
        (
            "choice",
            "Junta las manzanas. ¿Cuántas hay? 🍎🍎 🍎🍎🍎🍎",
            ("n:6", "n:4", "n:8"),
            ("n:6",),
            None,
        ),
        (
            "choice",
            "Junta las pelotas. ¿Cuántas hay? ⚽⚽⚽⚽ ⚽⚽⚽⚽",
            ("n:9", "n:10", "n:8"),
            ("n:8",),
            None,
        ),
    ],
    "mayor-1": [
        ("choice", "¿Cuál es el número mayor?", ("n:11", "n:8", "n:10"), ("n:11",), None),
        ("choice", "¿Cuál es el número mayor?", ("n:9", "n:3", "n:7"), ("n:9",), None),
        ("choice", "¿Cuál es el número mayor?", ("n:7", "n:18", "n:14"), ("n:18",), None),
    ],
    "mayor-2": [
        ("choice", "¿Cuál es el número mayor?", ("n:44", "n:35", "n:41"), ("n:44",), None),
        ("choice", "¿Cuál es el número mayor?", ("n:39", "n:14", "n:28"), ("n:39",), None),
        ("choice", "¿Cuál es el número mayor?", ("n:31", "n:75", "n:58"), ("n:75",), None),
    ],
    "ordena-1": [
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:11", "n:8", "n:20", "n:10"),
            ("n:8", "n:10", "n:11", "n:20"),
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:14", "n:7", "n:3", "n:9"),
            ("n:3", "n:7", "n:9", "n:14"),
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:18", "n:14", "n:7", "n:6"),
            ("n:6", "n:7", "n:14", "n:18"),
            None,
        ),
    ],
    "ordena-2": [
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:44", "n:35", "n:32", "n:41"),
            ("n:32", "n:35", "n:41", "n:44"),
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:28", "n:14", "n:39", "n:88"),
            ("n:14", "n:28", "n:39", "n:88"),
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:75", "n:58", "n:31", "n:26"),
            ("n:26", "n:31", "n:58", "n:75"),
            None,
        ),
    ],
    "que-sigue-1": [
        ("choice", "¿Qué número sigue? 4, 6, 8, …", ("n:12", "n:11", "n:10"), ("n:10",), None),
        ("choice", "¿Qué número sigue? 0, 2, 4, …", ("n:7", "n:6", "n:8"), ("n:6",), None),
        ("choice", "¿Qué número sigue? 8, 10, 12, …", ("n:12", "n:14", "n:16"), ("n:14",), None),
    ],
    "que-sigue-2": [
        ("choice", "¿Qué número sigue? 40, 45, 50, …", ("n:60", "n:56", "n:55"), ("n:55",), None),
        ("choice", "¿Qué número sigue? 10, 15, 20, …", ("n:26", "n:25", "n:30"), ("n:25",), None),
        ("choice", "¿Qué número sigue? 75, 80, 85, …", ("n:85", "n:90", "n:95"), ("n:90",), None),
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
            exercise.slots,
        )
        assert got == expected, f"{game_id} cambió con la semilla {seed}"
