"""CU-A21: salidas guardadas de los generadores de juegos (ADR 0004, estabilidad).

Si esta prueba falla, un generador cambió: los tokens en vuelo dejarían de verificarse (422) y los
intentos guardados con ese `game_kind` ya no corresponderían al mismo juego. La regla: NO se edita
un juego existente; se crea uno nuevo con otro id (o se sube la versión del token). Solo si el
cambio es intencional y se siguió esa regla, se regeneran estas salidas.

También detecta un cambio en `random` al subir de versión de Python.
"""

from __future__ import annotations

import uuid
from dataclasses import astuple

import pytest

from app.exercises.games import GAMES, GameExercise
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
            None,
        ),
        (
            "choice",
            "¿Qué signo va? 39 __ 39",
            ("s:mayor", "s:menor", "s:igual"),
            ("s:igual",),
            None,
            None,
        ),
        (
            "choice",
            "¿Qué signo va? 58 __ 31",
            ("s:igual", "s:menor", "s:mayor"),
            ("s:mayor",),
            None,
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
            None,
        ),
        (
            "fill",
            "Completa el camino: de 5 en 5.",
            ("n:15", "n:20", "n:25", "n:40", "n:30", "n:29", "n:35", "n:14"),
            ("n:15", "n:20", "n:25", "n:30", "n:35", "n:40"),
            ("n:15", "n:20", "n:25", None, None, "n:40"),
            None,
        ),
        (
            "fill",
            "Completa el camino: de 10 en 10.",
            ("n:40", "n:50", "n:80", "n:90", "n:89", "n:66", "n:70", "n:60"),
            ("n:40", "n:50", "n:60", "n:70", "n:80", "n:90"),
            ("n:40", "n:50", None, None, "n:80", "n:90"),
            None,
        ),
    ],
    "cuantos-1": [
        (
            "choice",
            "¿Cuántas manzanas hay? 🍎🍎🍎🍎🍎🍎🍎",
            ("n:6", "n:8", "n:7"),
            ("n:7",),
            None,
            None,
        ),
        ("choice", "¿Cuántas manzanas hay? 🍎🍎🍎", ("n:4", "n:3", "n:2"), ("n:3",), None, None),
        ("choice", "¿Cuántas pelotas hay? ⚽⚽⚽⚽⚽", ("n:4", "n:5", "n:7"), ("n:5",), None, None),
    ],
    "descompone-1": [
        ("choice", "8 = 3 + ? 🍎🍎🍎", ("n:3", "n:5", "n:6"), ("n:5",), None, None),
        ("choice", "4 = 1 + ? 🍎", ("n:3", "n:1", "n:5"), ("n:3",), None, None),
        ("choice", "6 = 2 + ? ⚽⚽", ("n:5", "n:6", "n:4"), ("n:4",), None, None),
    ],
    "donde-esta-1": [
        (
            "choice",
            "Toca lo que está a la izquierda de la caja, desde donde miras tú.",
            ("e:manzana-1", "e:flor-1", "e:pelota-1", "e:estrella-1"),
            ("e:flor-1",),
            None,
            (
                "📦",
                "caja",
                (
                    ("arriba", "e:manzana-1"),
                    ("izquierda", "e:flor-1"),
                    ("derecha", "e:pelota-1"),
                    ("abajo", "e:estrella-1"),
                ),
            ),
        ),
        (
            "choice",
            "Toca lo que está arriba de la caja.",
            ("e:manzana-1", "e:estrella-1", "e:pelota-1", "e:flor-1"),
            ("e:manzana-1",),
            None,
            (
                "📦",
                "caja",
                (
                    ("arriba", "e:manzana-1"),
                    ("izquierda", "e:estrella-1"),
                    ("derecha", "e:pelota-1"),
                    ("abajo", "e:flor-1"),
                ),
            ),
        ),
        (
            "choice",
            "Toca lo que está abajo de la caja.",
            ("e:pelota-1", "e:manzana-1", "e:estrella-1", "e:flor-1"),
            ("e:flor-1",),
            None,
            (
                "📦",
                "caja",
                (
                    ("arriba", "e:pelota-1"),
                    ("izquierda", "e:manzana-1"),
                    ("derecha", "e:estrella-1"),
                    ("abajo", "e:flor-1"),
                ),
            ),
        ),
    ],
    "donde-hay-mas-1": [
        (
            "choice",
            "¿Dónde hay más?",
            ("e:manzana-5", "e:manzana-6", "e:manzana-3"),
            ("e:manzana-6",),
            None,
            None,
        ),
        (
            "choice",
            "¿Dónde hay más?",
            ("e:manzana-4", "e:manzana-2", "e:manzana-1"),
            ("e:manzana-4",),
            None,
            None,
        ),
        (
            "choice",
            "¿Dónde hay más?",
            ("e:pelota-6", "e:pelota-5", "e:pelota-2"),
            ("e:pelota-6",),
            None,
            None,
        ),
    ],
    "figura-sigue-1": [
        (
            "choice",
            "¿Qué figura sigue?",
            ("f:circulo-amarillo", "f:triangulo-morado", "f:cuadrado-azul"),
            ("f:cuadrado-azul",),
            None,
            (
                "f:cuadrado-azul",
                "f:cuadrado-azul",
                "f:triangulo-morado",
                "f:cuadrado-azul",
                "f:cuadrado-azul",
                "f:triangulo-morado",
                "f:cuadrado-azul",
            ),
        ),
        (
            "choice",
            "¿Qué figura sigue?",
            ("f:cuadrado-azul", "f:triangulo-rojo", "f:circulo-amarillo"),
            ("f:circulo-amarillo",),
            None,
            (
                "f:circulo-amarillo",
                "f:circulo-amarillo",
                "f:triangulo-rojo",
                "f:circulo-amarillo",
                "f:circulo-amarillo",
                "f:triangulo-rojo",
                "f:circulo-amarillo",
            ),
        ),
        (
            "choice",
            "¿Qué figura sigue?",
            ("f:triangulo-rojo", "f:circulo-amarillo", "f:cuadrado-azul"),
            ("f:circulo-amarillo",),
            None,
            (
                "f:triangulo-rojo",
                "f:circulo-amarillo",
                "f:circulo-amarillo",
                "f:triangulo-rojo",
                "f:circulo-amarillo",
                "f:circulo-amarillo",
                "f:triangulo-rojo",
            ),
        ),
    ],
    "junta-1": [
        (
            "choice",
            "Junta las manzanas. ¿Cuántas hay? 🍎🍎🍎🍎🍎🍎 🍎🍎🍎🍎🍎🍎",
            ("n:10", "n:12", "n:13"),
            ("n:12",),
            None,
            None,
        ),
        (
            "choice",
            "Junta las manzanas. ¿Cuántas hay? 🍎🍎 🍎🍎🍎🍎",
            ("n:6", "n:4", "n:8"),
            ("n:6",),
            None,
            None,
        ),
        (
            "choice",
            "Junta las pelotas. ¿Cuántas hay? ⚽⚽⚽⚽ ⚽⚽⚽⚽",
            ("n:9", "n:10", "n:8"),
            ("n:8",),
            None,
            None,
        ),
    ],
    "mayor-1": [
        ("choice", "¿Cuál es el número mayor?", ("n:11", "n:8", "n:10"), ("n:11",), None, None),
        ("choice", "¿Cuál es el número mayor?", ("n:9", "n:3", "n:7"), ("n:9",), None, None),
        ("choice", "¿Cuál es el número mayor?", ("n:7", "n:18", "n:14"), ("n:18",), None, None),
    ],
    "mayor-2": [
        ("choice", "¿Cuál es el número mayor?", ("n:44", "n:35", "n:41"), ("n:44",), None, None),
        ("choice", "¿Cuál es el número mayor?", ("n:39", "n:14", "n:28"), ("n:39",), None, None),
        ("choice", "¿Cuál es el número mayor?", ("n:31", "n:75", "n:58"), ("n:75",), None, None),
    ],
    "mide-clips-1": [
        (
            "choice",
            "¿Cuántos clips mide la cinta?",
            ("n:7", "n:8", "n:9"),
            ("n:8",),
            None,
            ("cinta", "la cinta", "clip", "📎", 8),
        ),
        (
            "choice",
            "¿Cuántos clips mide la cinta?",
            ("n:3", "n:1", "n:2"),
            ("n:2",),
            None,
            ("cinta", "la cinta", "clip", "📎", 2),
        ),
        (
            "choice",
            "¿Cuántos clips mide la cinta?",
            ("n:4", "n:6", "n:5"),
            ("n:6",),
            None,
            ("cinta", "la cinta", "clip", "📎", 6),
        ),
    ],
    "ordena-1": [
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:11", "n:8", "n:20", "n:10"),
            ("n:8", "n:10", "n:11", "n:20"),
            None,
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:14", "n:7", "n:3", "n:9"),
            ("n:3", "n:7", "n:9", "n:14"),
            None,
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:18", "n:14", "n:7", "n:6"),
            ("n:6", "n:7", "n:14", "n:18"),
            None,
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
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:28", "n:14", "n:39", "n:88"),
            ("n:14", "n:28", "n:39", "n:88"),
            None,
            None,
        ),
        (
            "order",
            "Ordena de menor a mayor.",
            ("n:75", "n:58", "n:31", "n:26"),
            ("n:26", "n:31", "n:58", "n:75"),
            None,
            None,
        ),
    ],
    "pictograma-1": [
        (
            "choice",
            "Mira el pictograma. ¿Cuántas manzanas hay?",
            ("n:4", "n:7", "n:3"),
            ("n:4",),
            None,
            (("🍎", "manzanas", 4), ("🌸", "flores", 7), ("⚽", "pelotas", 3)),
        ),
        (
            "choice",
            "Mira el pictograma. ¿Cuántas pelotas hay?",
            ("n:3", "n:2", "n:4"),
            ("n:4",),
            None,
            (("⭐", "estrellas", 2), ("⚽", "pelotas", 4), ("🌸", "flores", 3)),
        ),
        (
            "choice",
            "Mira el pictograma. ¿Cuántas estrellas hay?",
            ("n:4", "n:2", "n:6"),
            ("n:4",),
            None,
            (("🌸", "flores", 2), ("⭐", "estrellas", 4), ("⚽", "pelotas", 6)),
        ),
    ],
    "que-sigue-1": [
        (
            "choice",
            "¿Qué número sigue? 4, 6, 8, …",
            ("n:12", "n:11", "n:10"),
            ("n:10",),
            None,
            None,
        ),
        ("choice", "¿Qué número sigue? 0, 2, 4, …", ("n:7", "n:6", "n:8"), ("n:6",), None, None),
        (
            "choice",
            "¿Qué número sigue? 8, 10, 12, …",
            ("n:12", "n:14", "n:16"),
            ("n:14",),
            None,
            None,
        ),
    ],
    "que-sigue-2": [
        (
            "choice",
            "¿Qué número sigue? 40, 45, 50, …",
            ("n:60", "n:56", "n:55"),
            ("n:55",),
            None,
            None,
        ),
        (
            "choice",
            "¿Qué número sigue? 10, 15, 20, …",
            ("n:26", "n:25", "n:30"),
            ("n:25",),
            None,
            None,
        ),
        (
            "choice",
            "¿Qué número sigue? 75, 80, 85, …",
            ("n:85", "n:90", "n:95"),
            ("n:90",),
            None,
            None,
        ),
    ],
    "toca-figura-1": [
        (
            "choice",
            "Toca el cuadrado.",
            ("f:cilindro-verde", "f:cuadrado-morado", "f:triangulo-azul"),
            ("f:cuadrado-morado",),
            None,
            None,
        ),
        (
            "choice",
            "Toca el triángulo.",
            ("f:triangulo-rojo", "f:cubo-azul", "f:circulo-amarillo"),
            ("f:triangulo-rojo",),
            None,
            None,
        ),
        (
            "choice",
            "Toca el triángulo.",
            ("f:triangulo-amarillo", "f:rectangulo-morado", "f:circulo-rojo"),
            ("f:triangulo-amarillo",),
            None,
            None,
        ),
    ],
}


def _visual(e: GameExercise) -> object:
    """Lo que se dibuja encima de las opciones (parte 3), o None."""
    if e.pattern is not None:
        return tuple(p.id for p in e.pattern)
    if e.picto is not None:
        return tuple(astuple(r) for r in e.picto)
    for drawn in (e.scene, e.measure):
        if drawn is not None:
            return astuple(drawn)
    return None


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
            _visual(exercise),
        )
        assert got == expected, f"{game_id} cambió con la semilla {seed}"
