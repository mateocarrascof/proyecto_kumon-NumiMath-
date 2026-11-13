"""Juegos de refuerzo para 1° y 2° básico (CU-A21, RF-41), parte 1: catálogo y generadores.

Dos tipos de ejercicio nuevos, generados por código determinista igual que la práctica (la IA no
participa):
- `choice` (opción): de 2 a 4 opciones; el niño toca una.
- `order` (orden): tarjetas que el niño deja en el orden pedido.

Las opciones son identificadores de texto ESTABLES con su tipo, `<tipo>:<valor>`:
- `n:7` número, `e:manzana-3` emoji (tres manzanas), `s:mayor` símbolo (">"), `f:cubo-rojo`
  figura SVG propia (parte 3; la app la dibuja según el id y `label` dice nombre y color).
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

GameKind = Literal["choice", "order", "fill"]
OptionKind = Literal["number", "emoji", "symbol", "figure", "time"]

# Ejes del catálogo curricular (columna `modulo` de docs/habilidades_1a4_basico.csv).
NUMBERS = "Números y operaciones"
PATTERNS = "Patrones y álgebra"
GEOMETRY = "Geometría"
MEASUREMENT = "Medición"
DATA = "Datos y probabilidades"


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
    # Ids de la respuesta correcta: una sola en `choice`; la secuencia completa en `order` y `fill`.
    solution: tuple[str, ...]
    # Solo `fill` (completar, CU-A21 parte 3): la secuencia con las tarjetas FIJAS en su lugar y
    # `None` en los huecos. No revela nada: las fijas se ven igual en la pantalla.
    slots: tuple[str | None, ...] | None = None
    # Lo que se dibuja ENCIMA de las opciones (parte 3). Es parte de la pregunta: se ve en la
    # pantalla, igual que los emoji del enunciado. Cada juego usa a lo más uno.
    pattern: tuple[GameOption, ...] | None = None  # fila de figuras antes del "?" (patrones)
    scene: GameScene | None = None  # escena en cruz: cada opción en una posición
    picto: tuple[PictoRow, ...] | None = None  # pictograma: una fila por categoría
    measure: GameMeasure | None = None  # un objeto medido con clips o pasos
    blocks: tuple[int, int] | None = None  # (decenas, unidades) en bloques (2°, parte 4)
    figure: GameOption | None = None  # una figura grande sobre las opciones (2°)
    clock: tuple[int, int] | None = None  # (hora 1 a 12, minuto 0 o 30): reloj dibujado (2°)
    scale: int | None = None  # pictograma con escala: cada ícono vale `scale` (2°)


@dataclass(frozen=True)
class GameScene:
    """Escena en cruz (tema 8): un objeto al centro y una opción en cada posición."""

    center: str  # emoji del centro
    center_name: str  # "caja"
    # (posición, id de la opción), en orden de lectura: arriba, izquierda, derecha, abajo.
    places: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class PictoRow:
    glyph: str
    name: str  # en plural: "manzanas"
    count: int


@dataclass(frozen=True)
class GameMeasure:
    thing: str  # id de lo que se mide (la app lo dibuja): lapiz, cinta, alfombra
    name: str  # con artículo: "el lápiz"
    unit: str  # "clip" o "paso"
    glyph: str  # emoji de la unidad
    length: int


def valid_answer(exercise: GameExercise, answer: list[str]) -> bool:
    """Forma de la respuesta (no si es correcta). `choice`: un id de las opciones. `order`: todas
    las tarjetas, una vez cada una. `fill`: la secuencia completa, con las fijas en su lugar y en
    cada hueco una tarjeta de las que no son fijas (sin repetir)."""
    shown = [o.id for o in exercise.options]
    if exercise.kind == "choice":
        return len(answer) == 1 and answer[0] in shown
    if exercise.kind == "order":
        return len(answer) == len(shown) and sorted(answer) == sorted(shown)
    slots = exercise.slots or ()
    if len(answer) != len(slots):
        return False
    fixed = {s for s in slots if s is not None}
    placed = [a for a, s in zip(answer, slots, strict=True) if s is None]
    if any(s is not None and a != s for a, s in zip(answer, slots, strict=True)):
        return False  # una tarjeta fija se movió o falta
    return len(set(placed)) == len(placed) and all(a in shown and a not in fixed for a in placed)


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
# Símbolos y unidades (2°: `s:cm` y `s:m`). Ningún juego recorre este diccionario: agregar no
# cambia los publicados.
_SYMBOLS = {"mayor": ">", "menor": "<", "igual": "=", "cm": "cm", "m": "m"}


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


def _near_range(values: list[int], gaps: list[int], step: int, high: int) -> list[int]:
    """Tarjetas que no van (1°): cerca del camino (±3), distintas de todo el camino y dentro de 0
    a `high` (con pasos de 1 los vecinos de un hueco ya están en el camino: por eso un rango)."""
    low_end, high_end = min(values), max(values)
    return [v for v in range(max(0, low_end - 3), min(high, high_end + 3) + 1) if v not in values]


def _near_step(values: list[int], gaps: list[int], step: int, high: int) -> list[int]:
    """Tarjetas que no van (2°): errores creíbles para el paso (±1/10 y ±1/2 del paso de cada
    hueco: 349 o 345 en un camino de 10 en 10), distintas del camino y dentro de 0 a `high`."""
    small = max(1, step // 10)
    pool = {
        values[g] + sign * delta for g in gaps for sign in (-1, 1) for delta in (small, step // 2)
    }
    return sorted(v for v in pool if 0 <= v <= high and v not in values)


def _fill_path(
    steps: tuple[int, ...],
    high: int,
    count: int,
    near: Callable[[list[int], list[int], int, int], list[int]],
    text: Callable[[int, bool], str],
    directions: tuple[bool, ...] = (False,),
) -> Callable[[random.Random], GameExercise]:
    """Completar un camino de `count` números contando de `step` en `step` (sube o baja), con 2
    huecos. Los dos primeros siempre se ven (para descubrir de cuánto en cuánto se cuenta)."""

    def make(rng: random.Random) -> GameExercise:
        step = rng.choice(steps)
        start = rng.randint(0, (high - (count - 1) * step) // step) * step
        values = [start + i * step for i in range(count)]
        # Con una sola dirección no se gasta azar (así completa-camino-1 da lo mismo que antes).
        down = rng.choice(directions) if len(directions) > 1 else directions[0]
        if down:
            values.reverse()
        gaps = sorted(rng.sample(range(2, count), 2))
        wrong = rng.sample(near(values, gaps, step, high), 2)
        fixed = [_number(v) for i, v in enumerate(values) if i not in gaps]
        candidates = _shuffled(
            rng, [*(_number(values[g]) for g in gaps), *(_number(v) for v in wrong)]
        )
        slots = tuple(None if i in gaps else f"n:{v}" for i, v in enumerate(values))
        return GameExercise(
            "fill",
            text(step, down),
            (*fixed, *candidates),
            tuple(f"n:{v}" for v in values),
            slots,
        )

    return make


# Completa el camino (1°, tema 1): 6 números de 1, 2, 5 o 10 hasta 100.
_fill_steps = _fill_path(
    (1, 2, 5, 10), 100, 6, _near_range, lambda step, _: f"Completa el camino: de {step} en {step}."
)


# Objetos con nombre masculino (hoy ninguno: "las manzanas", "las pelotas"). Los textos de los
# juegos nuevos concuerdan con el objeto ("los"/"las", "cuántos"/"cuántas").
_MASCULINE_OBJECTS: frozenset[str] = frozenset()


def _the(obj: str) -> str:
    return "los" if obj in _MASCULINE_OBJECTS else "las"


def _how_many_word(obj: str) -> str:
    return "Cuántos" if obj in _MASCULINE_OBJECTS else "Cuántas"


def _decompose(rng: random.Random) -> GameExercise:
    """Componer y descomponer (tema 4): "5 = 3 + ?" con los objetos que ya hay."""
    obj = rng.choice(sorted(_OBJECTS))
    total = rng.randint(3, 10)
    have = rng.randint(1, total - 1)
    missing = total - have
    values = [missing, *_distractors(rng, missing, 0, 10, 2)]
    return GameExercise(
        "choice",
        f"{total} = {have} + ? {_OBJECTS[obj][0] * have}",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{missing}",),
    )


def _join(rng: random.Random) -> GameExercise:
    """Sumas hasta 20 juntando objetos (tema 5): dos grupos y "¿cuántas hay?"."""
    obj = rng.choice(sorted(_OBJECTS))
    a = rng.randint(1, 9)
    b = rng.randint(1, 9)
    glyph, plural = _OBJECTS[obj]
    values = [a + b, *_distractors(rng, a + b, 2, 20, 2)]
    return GameExercise(
        "choice",
        f"Junta {_the(obj)} {plural}. ¿{_how_many_word(obj)} hay? {glyph * a} {glyph * b}",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{a + b}",),
    )


# ---- Figuras (temas 6 y 7) ---------------------------------------------------------------------
# Se distinguen por la FORMA (la app las dibuja con borde oscuro); el color es un apoyo, nunca la
# única diferencia. La etiqueta dice nombre y color para el lector de pantalla ("triángulo rojo").

_SHAPES: dict[str, tuple[str, bool]] = {
    # id → (nombre, es femenino)
    "circulo": ("círculo", False),
    "cuadrado": ("cuadrado", False),
    "triangulo": ("triángulo", False),
    "rectangulo": ("rectángulo", False),
    "cubo": ("cubo", False),
    "esfera": ("esfera", True),
    "cilindro": ("cilindro", False),
}
_COLORS: dict[str, tuple[str, str]] = {
    # id → (masculino, femenino)
    "rojo": ("rojo", "roja"),
    "azul": ("azul", "azul"),
    "verde": ("verde", "verde"),
    "amarillo": ("amarillo", "amarilla"),
    "morado": ("morado", "morada"),
}
# Familias de formas que se confunden: un cuadrado también es rectángulo, la esfera se dibuja como
# un círculo con ecuador y el cubo muestra un cuadrado de frente. En "Toca la figura" va a lo más
# una forma de cada familia, así la respuesta es una sola (revisión de código, CU-A21 parte 3).
_SHAPE_FAMILIES: tuple[tuple[str, ...], ...] = (
    ("cuadrado", "rectangulo", "cubo"),
    ("circulo", "esfera"),
    ("triangulo",),
    ("cilindro",),
)
# Patrones con 3 formas planas bien distintas (cuadrado y rectángulo se parecen en chico).
_PATTERN_SHAPES = ("circulo", "cuadrado", "triangulo")
# Unidades de patrón (1-14): AB, ABC, AAB y ABB.
_PATTERN_UNITS: tuple[tuple[int, ...], ...] = ((0, 1), (0, 1, 2), (0, 0, 1), (0, 1, 1))


# Polígonos de 2° (lados y vértices). Aparte de _SHAPES: "Toca la figura" (publicado) recorre
# _SHAPES y no debe cambiar.
_POLYGONS: dict[str, tuple[str, bool]] = {"pentagono": ("pentágono", False)}
_POLYGONS["hexagono"] = ("hexágono", False)
_SIDES = {"triangulo": 3, "cuadrado": 4, "rectangulo": 4, "pentagono": 5, "hexagono": 6}


def _figure(shape: str, color: str) -> GameOption:
    name, feminine = _SHAPES[shape] if shape in _SHAPES else _POLYGONS[shape]
    return GameOption(f"f:{shape}-{color}", "figure", f"{name} {_COLORS[color][int(feminine)]}")


def _figure_next(rng: random.Random) -> GameExercise:
    """Patrones (tema 6): una fila de figuras y "¿qué figura sigue?". Se muestran al menos dos
    vueltas completas del patrón, así la respuesta es una sola."""
    unit = rng.choice(_PATTERN_UNITS)
    shapes = rng.sample(_PATTERN_SHAPES, 3)
    colors = rng.sample(sorted(_COLORS), 3)
    figures = [_figure(s, c) for s, c in zip(shapes, colors, strict=True)]
    shown = 2 * len(unit) + rng.randint(0, 1)
    pattern = tuple(figures[unit[i % len(unit)]] for i in range(shown))
    right = figures[unit[shown % len(unit)]]
    return GameExercise(
        "choice", "¿Qué figura sigue?", _shuffled(rng, figures), (right.id,), pattern=pattern
    )


def _touch_figure(rng: random.Random) -> GameExercise:
    """Figuras 2D y 3D (tema 7): "Toca el cilindro" entre 3 figuras de familias distintas (sin
    parejas que se confundan, como cuadrado y rectángulo)."""
    # La pedida sale pareja entre las 7 formas; las otras dos, de otras familias.
    target = rng.choice(sorted(_SHAPES))
    others = rng.sample([f for f in _SHAPE_FAMILIES if target not in f], 2)
    shapes = [target, *(rng.choice(f) for f in others)]
    colors = rng.sample(sorted(_COLORS), 3)
    figures = [_figure(s, c) for s, c in zip(shapes, colors, strict=True)]
    name, feminine = _SHAPES[shapes[0]]
    return GameExercise(
        "choice",
        f"Toca {'la' if feminine else 'el'} {name}.",
        _shuffled(rng, figures),
        (figures[0].id,),
    )


# ---- Escena, medición y pictograma (temas 8 a 10) ---------------------------------------------

# Orden de lectura de la cruz (también el orden de las opciones para el teclado).
_POSITIONS = ("arriba", "izquierda", "derecha", "abajo")
_WHERE_TEXT = {
    "arriba": "Toca lo que está arriba de la caja.",
    "abajo": "Toca lo que está abajo de la caja.",
    # Izquierda y derecha desde quien mira la pantalla (decisión del dueño).
    "izquierda": "Toca lo que está a la izquierda de la caja, desde donde miras tú.",
    "derecha": "Toca lo que está a la derecha de la caja, desde donde miras tú.",
}


def _where_is(rng: random.Random) -> GameExercise:
    """Orientación (tema 8): una caja al centro y un objeto arriba, abajo, a la izquierda y a la
    derecha. Cada objeto es una opción."""
    objects = rng.sample(sorted(_OBJECTS), 4)
    options = tuple(_emoji_group(o, 1) for o in objects)
    places = tuple((p, o.id) for p, o in zip(_POSITIONS, options, strict=True))
    asked = rng.choice(_POSITIONS)
    return GameExercise(
        "choice",
        _WHERE_TEXT[asked],
        options,
        (dict(places)[asked],),
        scene=GameScene("📦", "caja", places),
    )


_MEASURED = {
    # id → (nombre con artículo, unidad)
    "lapiz": ("el lápiz", "clip"),
    "cinta": ("la cinta", "clip"),
    "alfombra": ("la alfombra", "paso"),
}
_UNITS = {"clip": ("📎", "clips"), "paso": ("👣", "pasos")}


def _measure(rng: random.Random) -> GameExercise:
    """Longitud con unidades no estandarizadas (tema 9): un objeto con clips (o pasos) en fila
    debajo, del mismo largo. "¿Cuántos clips mide el lápiz?" """
    thing = rng.choice(sorted(_MEASURED))
    name, unit = _MEASURED[thing]
    glyph, plural = _UNITS[unit]
    length = rng.randint(2, 8)
    values = [length, *_distractors(rng, length, 1, 10, 2)]
    return GameExercise(
        "choice",
        f"¿Cuántos {plural} mide {name}?",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{length}",),
        measure=GameMeasure(thing, name, unit, glyph, length),
    )


def _pictogram(rng: random.Random) -> GameExercise:
    """Pictogramas (tema 10): 2 o 3 filas y "¿Cuántas manzanas hay?". Las cantidades de las otras
    filas sirven de distractores (leer la fila equivocada es el error típico)."""
    objects = rng.sample(sorted(_OBJECTS), rng.choice((2, 3)))
    counts = rng.sample(range(1, 9), len(objects))
    rows = tuple(PictoRow(*_OBJECTS[o], c) for o, c in zip(objects, counts, strict=True))
    asked = rng.randrange(len(rows))
    right = counts[asked]
    others = [c for i, c in enumerate(counts) if i != asked][:2]
    near = [v for v in range(max(1, right - 2), right + 3) if v != right and v not in others]
    values = [right, *others, *rng.sample(near, 2 - len(others))]
    return GameExercise(
        "choice",
        f"Mira el pictograma. ¿{_how_many_word(objects[asked])} {rows[asked].name} hay?",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{right}",),
        picto=rows,
    )


# ---- 2° básico (CU-A21, parte 4) --------------------------------------------------------------

_UNITS_WORDS = [
    "cero",
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
    "diez",
    "once",
    "doce",
    "trece",
    "catorce",
    "quince",
    "dieciséis",
    "diecisiete",
    "dieciocho",
    "diecinueve",
    "veinte",
    "veintiuno",
    "veintidós",
    "veintitrés",
    "veinticuatro",
    "veinticinco",
    "veintiséis",
    "veintisiete",
    "veintiocho",
    "veintinueve",
]
_TENS_WORDS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta", 7: "setenta"}
_TENS_WORDS |= {8: "ochenta", 9: "noventa"}


def number_words(n: int) -> str:
    """Número de 0 a 100 en palabras: 47 → "cuarenta y siete"."""
    if not 0 <= n <= 100:
        raise ValueError(n)
    if n == 100:
        return "cien"
    if n < 30:
        return _UNITS_WORDS[n]
    tens, ones = divmod(n, 10)
    return _TENS_WORDS[tens] if ones == 0 else f"{_TENS_WORDS[tens]} y {_UNITS_WORDS[ones]}"


def _read_number(rng: random.Random) -> GameExercise:
    """Leer números hasta 100 (2°, tema 2): el número en palabras y tocar su representación.
    Distractores: las cifras al revés (74 por 47) y uno cercano."""
    n = rng.randint(20, 99)
    swapped = (n % 10) * 10 + n // 10
    pool = [v for v in (swapped, n + 10, n - 10, n + 1, n - 1) if 10 <= v <= 100 and v != n]
    wrong = list(dict.fromkeys(pool))[:1] + rng.sample(list(dict.fromkeys(pool))[1:], 1)
    return GameExercise(
        "choice",
        f"Toca el número {number_words(n)}.",
        _shuffled(rng, [_number(v) for v in (n, *wrong)]),
        (f"n:{n}",),
    )


def _blocks_number(rng: random.Random) -> GameExercise:
    """Componer números (2°, tema 3): decenas y unidades en bloques; "¿qué número forman?"."""
    tens = rng.randint(1, 9)
    ones = rng.randint(0, 9)
    n = tens * 10 + ones
    pool = [ones * 10 + tens, n + 10, n - 10, n + 1, n - 1]
    pool = [v for v in dict.fromkeys(pool) if 1 <= v <= 99 and v != n]
    return GameExercise(
        "choice",
        "¿Qué número forman los bloques?",
        _shuffled(rng, [_number(v) for v in (n, *rng.sample(pool, 2))]),
        (f"n:{n}",),
        blocks=(tens, ones),
    )


def _blocks_sum(rng: random.Random) -> GameExercise:
    """Sumas hasta 100 (2°, tema 4): mitad de las rondas sin reserva y mitad con reserva. Los
    bloques muestran las decenas y las unidades juntas: con 10 o más unidades hay que agrupar 10
    en una decena. El error típico (olvidar la decena) es un distractor."""
    carry = rng.random() < 0.5
    while True:
        a, b = rng.randint(11, 79), rng.randint(2, 39)
        ones = a % 10 + b % 10
        if a + b <= 99 and (ones >= 10) == carry:
            break
    total = a + b
    # Sin agrupar la decena (con reserva) o agrupando de más (sin reserva); nunca sobre 100.
    forgot = total - 10 if carry or total + 10 > 100 else total + 10
    near = rng.choice([v for v in (total + 1, total - 1) if v != forgot])
    return GameExercise(
        "choice",
        f"{a} + {b} = ? Junta los bloques.",
        _shuffled(rng, [_number(v) for v in (total, forgot, near)]),
        (f"n:{total}",),
        blocks=(a // 10 + b // 10, ones),
    )


def _equal_groups(rng: random.Random) -> GameExercise:
    """Multiplicación como suma repetida (2°, tema 5): grupos iguales de 2, 5 o 10 objetos.
    Distractores: un grupo de más o de menos (contar mal los grupos)."""
    size = rng.choice((2, 5, 10))
    groups = rng.randint(2, 3 if size == 10 else 5)
    obj = rng.choice(sorted(_OBJECTS))
    glyph, plural = _OBJECTS[obj]
    total = size * groups
    values = [total, total + size, total - size if groups > 1 else total + 2 * size]
    return GameExercise(
        "choice",
        f"¿{_how_many_word(obj)} {plural} hay en total? {' '.join([glyph * size] * groups)}",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{total}",),
    )


# Contar hasta 1.000 (2°, tema 1): 5 números de 10 en 10 o de 100 en 100.
_count_to_1000 = _fill_path(
    (10, 100), 1000, 5, _near_step, lambda step, _: f"Completa el camino: de {step} en {step}."
)
# Patrones que suben o bajan (2°, tema 6): 6 números de 2, 5 o 10, hasta 100.
_fill_pattern = _fill_path(
    (2, 5, 10),
    100,
    6,
    _near_step,
    lambda step, down: f"Completa el patrón: {'baja' if down else 'sube'} de {step} en {step}.",
    directions=(False, True),
)


def _count_sides(rng: random.Random) -> GameExercise:
    """Figuras 2D (2°, tema 8): una figura grande y "¿cuántos lados (o vértices) tiene?"."""
    shape = rng.choice(sorted(_SIDES))
    figure = _figure(shape, rng.choice(sorted(_COLORS)))
    what = rng.choice(("lados", "vértices"))
    n = _SIDES[shape]
    values = [n, n + 1, n - 1 if n > 3 else n + 2]
    return GameExercise(
        "choice",
        f"¿Cuántos {what} tiene esta figura?",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{n}",),
        figure=figure,
    )


# Objetos para elegir la unidad (2°, tema 9): (nombre con artículo, emoji, unidad que conviene).
_TO_MEASURE = (
    ("el lápiz", "✏️", "cm"),
    ("la llave", "🔑", "cm"),
    ("la cuchara", "🥄", "cm"),
    ("el bus", "🚌", "m"),
    ("la casa", "🏠", "m"),
    ("la ballena", "🐋", "m"),
)


def _choose_unit(rng: random.Random) -> GameExercise:
    """Longitud en cm y m (2°, tema 9): ¿con qué unidad conviene medir este objeto?"""
    name, glyph, unit = rng.choice(_TO_MEASURE)
    return GameExercise(
        "choice",
        f"¿Qué usarías para medir {name}: centímetros o metros? {glyph}",
        _shuffled(rng, [_symbol("cm"), _symbol("m")]),
        (f"s:{unit}",),
    )


def _time(hour: int, minute: int) -> GameOption:
    return GameOption(f"t:{hour}-{minute:02d}", "time", f"{hour}:{minute:02d}")


def _read_clock(rng: random.Random) -> GameExercise:
    """Horas y medias horas (2°, tema 10): un reloj dibujado y "¿qué hora marca?". Distractores:
    la otra media hora de la misma hora y la hora siguiente (leer mal la manecilla corta)."""
    hour = rng.randint(1, 12)
    minute = rng.choice((0, 30))
    options = [_time(hour, minute), _time(hour, 30 - minute), _time(hour % 12 + 1, minute)]
    return GameExercise(
        "choice",
        "¿Qué hora marca el reloj?",
        _shuffled(rng, options),
        (options[0].id,),
        clock=(hour, minute),
    )


def _scaled_pictogram(rng: random.Random) -> GameExercise:
    """Pictograma con escala (2°, tema 11): cada ícono vale 2 o 5. Distractores: contar los
    íconos sin la escala (el error típico) y el valor de otra fila."""
    scale = rng.choice((2, 5))
    objects = rng.sample(sorted(_OBJECTS), rng.choice((2, 3)))
    icons = rng.sample(range(1, 7), len(objects))
    rows = tuple(PictoRow(*_OBJECTS[o], c) for o, c in zip(objects, icons, strict=True))
    asked = rng.randrange(len(rows))
    right = icons[asked] * scale
    other = next(c * scale for i, c in enumerate(icons) if i != asked)
    values = list(dict.fromkeys([right, icons[asked], other, right + scale]))[:3]
    return GameExercise(
        "choice",
        f"Cada ícono vale {scale}. ¿{_how_many_word(objects[asked])} {rows[asked].name} hay?",
        _shuffled(rng, [_number(v) for v in values]),
        (f"n:{right}",),
        picto=rows,
        scale=scale,
    )


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
        # CU-A21, parte 3 (1° básico, un juego por tema). Ids nuevos; los anteriores no se editan.
        Game("completa-camino-1", "Completa el camino", NUMBERS, 1, "fill", "1-01", _fill_steps),
        Game("descompone-1", "¿Cuántos faltan?", NUMBERS, 1, "choice", "1-04", _decompose),
        Game("junta-1", "Junta y cuenta", NUMBERS, 1, "choice", "1-08", _join),
        Game("figura-sigue-1", "¿Qué figura sigue?", PATTERNS, 1, "choice", "1-14", _figure_next),
        Game("toca-figura-1", "Toca la figura", GEOMETRY, 1, "choice", "1-17", _touch_figure),
        Game(
            "donde-esta-1",
            "Arriba, abajo, izquierda y derecha",
            GEOMETRY,
            1,
            "choice",
            "1-16",
            _where_is,
        ),
        Game("mide-clips-1", "Mide con clips y pasos", MEASUREMENT, 1, "choice", "1-19", _measure),
        Game("pictograma-1", "Lee el pictograma", DATA, 1, "choice", "1-22", _pictogram),
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
        # CU-A21, parte 4 (2° básico, un juego por tema). Ids nuevos.
        Game("cuenta-mil-2", "Cuenta hasta 1.000", NUMBERS, 2, "fill", "2-01", _count_to_1000),
        Game("lee-numero-2", "Lee el número", NUMBERS, 2, "choice", "2-02", _read_number),
        Game("arma-numero-2", "Decenas y unidades", NUMBERS, 2, "choice", "2-04", _blocks_number),
        Game("suma-bloques-2", "Suma con bloques", NUMBERS, 2, "choice", "2-07", _blocks_sum),
        Game("grupos-iguales-2", "Grupos iguales", NUMBERS, 2, "choice", "2-11", _equal_groups),
        Game("cuenta-lados-2", "Lados y vértices", GEOMETRY, 2, "choice", "2-18", _count_sides),
        Game(
            "elige-unidad-2", "Centímetros o metros", MEASUREMENT, 2, "choice", "2-22", _choose_unit
        ),
        Game("lee-reloj-2", "¿Qué hora es?", MEASUREMENT, 2, "choice", "2-21", _read_clock),
        Game(
            "pictograma-escala-2",
            "Pictograma con escala",
            DATA,
            2,
            "choice",
            "2-24",
            _scaled_pictogram,
        ),
        Game(
            "completa-patron-2",
            "Patrones que suben y bajan",
            PATTERNS,
            2,
            "fill",
            "2-15",
            _fill_pattern,
        ),
    )
}

# Solo estos cursos tienen juegos (CU-A21, parte 1).
GAME_GRADES = frozenset({1, 2})

# Mensajes para el niño: cortos y sin culpa. Lo correcto se muestra solo DESPUÉS de responder.
GAME_MESSAGES = {
    "correct": "¡Muy bien!",
    "choice_wrong": "Casi. Esta era la respuesta.",
    "order_wrong": "Casi. Así quedaba el orden.",
    "fill_wrong": "Casi. Así quedaba el camino.",
}


def games_for_grade(grade: int) -> list[Game]:
    return [g for g in GAMES.values() if g.grade == grade]
