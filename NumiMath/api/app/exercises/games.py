"""Juegos de refuerzo para 1° y 2° básico (CU-A21, RF-41), parte 1: catálogo y generadores.

Dos tipos de ejercicio nuevos, generados por código determinista igual que la práctica (la IA no
participa):
- `choice` (opción): de 2 a 4 opciones; el niño toca una.
- `order` (orden): tarjetas que el niño deja en el orden pedido.

Las opciones son identificadores de texto ESTABLES con su tipo, `<tipo>:<valor>`:
- `n:7` número, `e:manzana-3` emoji (tres manzanas), `s:mayor` símbolo (">").
Así, en la parte 3 se pueden agregar figuras SVG propias (`f:triangulo`, por ejemplo) sin cambiar el
formato del token ni de la respuesta. La app muestra `label`; el servidor solo compara ids.

Lo correcto NUNCA viaja hacia la app antes de responder: el token lleva las opciones en el orden en
que se muestran (barajadas) y el servidor regenera la solución desde la semilla del token.

Cada juego pertenece a una habilidad del catálogo curricular (docs/habilidades_1a4_basico.csv); no
se inventan códigos. Los juegos NO cambian el nivel ni el bloque de esa habilidad (`record_attempt`
con `activity = 'game'`).
"""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

GameKind = Literal["choice", "order"]
OptionKind = Literal["number", "emoji", "symbol"]

NUMBERS = "Números y operaciones"
PATTERNS = "Patrones y álgebra"


@dataclass(frozen=True)
class GameOption:
    id: str
    kind: OptionKind
    label: str


@dataclass(frozen=True)
class GameExercise:
    kind: GameKind
    text: str
    # En el orden en que se muestran (barajadas).
    options: tuple[GameOption, ...]
    # Ids de la respuesta correcta: una sola en `choice`; la secuencia completa en `order`.
    solution: tuple[str, ...]


@dataclass(frozen=True)
class Game:
    id: str
    name: str
    module: str
    grade: int
    kind: GameKind
    skill: str
    make: Callable[[random.Random], GameExercise]


# ---- Opciones ---------------------------------------------------------------------------------

_OBJECTS: dict[str, tuple[str, str]] = {
    # id → (emoji, nombre en plural para el enunciado)
    "manzana": ("🍎", "manzanas"),
    "estrella": ("⭐", "estrellas"),
    "pelota": ("⚽", "pelotas"),
    "flor": ("🌸", "flores"),
}
_SYMBOLS = {"mayor": ">", "menor": "<", "igual": "="}


def _number(value: int) -> GameOption:
    return GameOption(f"n:{value}", "number", str(value))


def _emoji_group(obj: str, count: int) -> GameOption:
    return GameOption(f"e:{obj}-{count}", "emoji", _OBJECTS[obj][0] * count)


def _symbol(name: str) -> GameOption:
    return GameOption(f"s:{name}", "symbol", _SYMBOLS[name])


def _shuffled(rng: random.Random, options: list[GameOption]) -> tuple[GameOption, ...]:
    out = list(options)
    rng.shuffle(out)
    return tuple(out)


def _distractors(rng: random.Random, right: int, low: int, high: int, spread: int) -> list[int]:
    """Dos números distintos de `right`, cercanos (dentro de `spread`) y en [low, high]."""
    near = [v for v in range(right - spread, right + spread + 1) if low <= v <= high and v != right]
    return rng.sample(near, 2)


# ---- Generadores ------------------------------------------------------------------------------


def _biggest(high: int) -> Callable[[random.Random], GameExercise]:
    def make(rng: random.Random) -> GameExercise:
        values = rng.sample(range(0, high + 1), 3)
        options = [_number(v) for v in values]
        return GameExercise(
            "choice", "¿Cuál es el número mayor?", _shuffled(rng, options), (f"n:{max(values)}",)
        )

    return make


def _sort_ascending(high: int) -> Callable[[random.Random], GameExercise]:
    def make(rng: random.Random) -> GameExercise:
        values = rng.sample(range(0, high + 1), 4)
        cards = _shuffled(rng, [_number(v) for v in values])
        solution = tuple(f"n:{v}" for v in sorted(values))
        if tuple(c.id for c in cards) == solution:
            # Que no aparezca ya ordenado: se rota una posición (sigue siendo determinista).
            cards = cards[1:] + cards[:1]
        return GameExercise("order", "Ordena de menor a mayor.", cards, solution)

    return make


def _how_many(rng: random.Random) -> GameExercise:
    obj = rng.choice(sorted(_OBJECTS))
    count = rng.randint(2, 10)
    glyph, plural = _OBJECTS[obj]
    values = [count, *_distractors(rng, count, 1, 10, 2)]
    return GameExercise(
        "choice",
        f"¿Cuántas {plural} hay? {glyph * count}",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{count}",),
    )


def _where_more(rng: random.Random) -> GameExercise:
    obj = rng.choice(sorted(_OBJECTS))
    counts = rng.sample(range(1, 7), 3)
    options = [_emoji_group(obj, c) for c in counts]
    return GameExercise(
        "choice", "¿Dónde hay más?", _shuffled(rng, options), (f"e:{obj}-{max(counts)}",)
    )


def _what_next(steps: tuple[int, ...], high: int) -> Callable[[random.Random], GameExercise]:
    def make(rng: random.Random) -> GameExercise:
        step = rng.choice(steps)
        start = rng.randint(0, high - 4 * step) // step * step
        shown = [start + i * step for i in range(3)]
        right = start + 3 * step
        wrong = [v for v in (right - step, right + step, right + 1, right - 1) if 0 <= v <= high]
        wrong = [v for v in dict.fromkeys(wrong) if v != right]
        values = [right, *rng.sample(wrong, 2)]
        return GameExercise(
            "choice",
            f"¿Qué número sigue? {', '.join(map(str, shown))}, …",
            _shuffled(rng, [_number(v) for v in values]),
            (f"n:{right}",),
        )

    return make


def _which_sign(rng: random.Random) -> GameExercise:
    a = rng.randint(0, 100)
    # Uno de cada cinco, iguales: que "=" también sea respuesta posible.
    b = a if rng.random() < 0.2 else rng.choice([v for v in range(0, 101) if v != a])
    right = "mayor" if a > b else "menor" if a < b else "igual"
    options = [_symbol(name) for name in ("mayor", "menor", "igual")]
    return GameExercise(
        "choice", f"¿Qué signo va? {a} __ {b}", _shuffled(rng, options), (f"s:{right}",)
    )


# ---- Catálogo (registro simple en código) -----------------------------------------------------

GAMES: dict[str, Game] = {
    g.id: g
    for g in (
        Game("mayor-1", "¿Cuál es mayor?", NUMBERS, 1, "choice", "1-03", _biggest(20)),
        Game("cuantos-1", "¿Cuántos hay?", NUMBERS, 1, "choice", "1-02", _how_many),
        Game("donde-hay-mas-1", "¿Dónde hay más?", NUMBERS, 1, "choice", "1-03", _where_more),
        Game("ordena-1", "Ordena los números", NUMBERS, 1, "order", "1-03", _sort_ascending(20)),
        Game(
            "que-sigue-1",
            "¿Qué número sigue?",
            PATTERNS,
            1,
            "choice",
            "1-13",
            _what_next((1, 2), 20),
        ),
        Game("mayor-2", "¿Cuál es mayor?", NUMBERS, 2, "choice", "2-03", _biggest(100)),
        Game("ordena-2", "Ordena los números", NUMBERS, 2, "order", "2-03", _sort_ascending(100)),
        Game(
            "que-sigue-2",
            "¿Qué número sigue?",
            PATTERNS,
            2,
            "choice",
            "2-15",
            _what_next((2, 5, 10), 100),
        ),
        Game("compara-signo-2", "¿Qué signo va?", PATTERNS, 2, "choice", "2-16", _which_sign),
    )
}

# Solo estos cursos tienen juegos (CU-A21, parte 1).
GAME_GRADES = frozenset({1, 2})

# Mensajes para el niño: cortos y sin culpa. Lo correcto se muestra solo DESPUÉS de responder.
GAME_MESSAGES = {
    "correct": "¡Muy bien!",
    "choice_wrong": "Casi. Esta era la respuesta.",
    "order_wrong": "Casi. Así quedaba el orden.",
}


def games_for_grade(grade: int) -> list[Game]:
    return [g for g in GAMES.values() if g.grade == grade]
