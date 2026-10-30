"""Generadores de ejercicios por habilidad y nivel (fase A del catálogo curricular).

Cada habilidad de fase A de `docs/habilidades_1a4_basico.csv` tiene un generador; cada nivel sigue
las columnas `nivel_1`, `nivel_2` y `nivel_3` del CSV. Familias y criterios:
docs/MAPA_CURRICULAR_MATEMATICA_1A4.md (sección 3).

Cada generador recibe un `random.Random` ya sembrado (la semilla sale de una función HMAC del
servidor, así que el cliente no puede calcular la respuesta) y el nivel (1 a 3). Devuelve el
enunciado y la respuesta: siempre un entero ≥ 0, o una fracción (`answer_den`) en 4-10.
Reglas: sin resultados negativos, respuesta única, enunciado de 200 caracteres como máximo. Sin
`eval`: la respuesta se calcula aquí, nunca se interpreta texto.
"""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass

from app.exercises.levels import clamp_level


@dataclass(frozen=True)
class Exercise:
    text: str
    answer: int
    # Solo en ejercicios de fracciones: la respuesta es answer / answer_den.
    answer_den: int | None = None

    @property
    def is_fraction(self) -> bool:
        return self.answer_den is not None


Generator = Callable[[random.Random, int], Exercise]

# Objetos para contar: (emoji, nombre en plural, "Cuántas"/"Cuántos").
_OBJECTS = (
    ("🍎", "manzanas", "Cuántas"),
    ("⭐", "estrellas", "Cuántas"),
    ("🐟", "peces", "Cuántos"),
    ("🌸", "flores", "Cuántas"),
    ("⚽", "pelotas", "Cuántas"),
)


def _n(value: int) -> str:
    """Número con punto de miles (como en Chile): 4.520."""
    return f"{value:,}".replace(",", ".")


def _seq(values: list[int]) -> str:
    return ", ".join(_n(v) for v in values)


# ---- Familias ------------------------------------------------------------------------------


def _next_in_sequence(start: int, step: int, terms: int = 4) -> Exercise:
    """`start, start+step, …` (step puede ser negativo). Pregunta el que sigue."""
    values = [start + i * step for i in range(terms)]
    return Exercise(f"{_seq(values)}, … ¿Qué número sigue?", start + terms * step)


def _missing_in_sequence(rng: random.Random, start: int, step: int, terms: int = 5) -> Exercise:
    """Serie con un término del medio oculto."""
    values = [start + i * step for i in range(terms)]
    hidden = rng.randint(1, terms - 2)
    shown = ["?" if i == hidden else _n(v) for i, v in enumerate(values)]
    return Exercise(f"{', '.join(shown)}. ¿Qué número falta?", values[hidden])


def _compare_two(rng: random.Random, low: int, high: int) -> Exercise:
    a, b = rng.sample(range(low, high + 1), 2)
    if rng.random() < 0.5:
        return Exercise(f"¿Cuál es el número mayor: {_n(a)} o {_n(b)}?", max(a, b))
    return Exercise(f"¿Cuál es el número menor: {_n(a)} o {_n(b)}?", min(a, b))


def _order(rng: random.Random, low: int, high: int, allow_four: bool) -> Exercise:
    count = rng.choice((3, 4)) if allow_four else 3
    values = rng.sample(range(low, high + 1), count)
    shown = ", ".join(_n(v) for v in values[:-1]) + f" y {_n(values[-1])}"
    ordered = sorted(values)
    if count == 3:
        return Exercise(f"Ordena {shown} de menor a mayor. ¿Qué número queda al medio?", ordered[1])
    return Exercise(f"Ordena {shown} de menor a mayor. ¿Qué número queda segundo?", ordered[1])


def _add(a: int, b: int) -> Exercise:
    return Exercise(f"{_n(a)} + {_n(b)} = ?", a + b)


def _sub(a: int, b: int) -> Exercise:
    return Exercise(f"{_n(a)} − {_n(b)} = ?", a - b)


def _missing_addend(a: int, total: int) -> Exercise:
    return Exercise(f"{_n(a)} + ? = {_n(total)}", total - a)


def _missing_subtrahend(a: int, result: int) -> Exercise:
    return Exercise(f"{_n(a)} − ? = {_n(result)}", a - result)


def _sum_to(rng: random.Random, low: int, high: int, max_addend: int) -> tuple[int, int]:
    """Dos sumandos ≥ 1 y ≤ max_addend cuyo resultado está entre low y high."""
    total = rng.randint(low, high)
    a = rng.randint(max(1, total - max_addend), min(max_addend, total - 1))
    return a, total - a


def _digits(value: int, places: int) -> list[int]:
    return [(value // 10**i) % 10 for i in range(places)]


def _no_carry_pair(rng: random.Random, places_a: int, places_b: int) -> tuple[int, int]:
    """a + b sin reserva: cada columna suma ≤ 9. La cifra mayor de cada número es ≥ 1."""
    while True:
        a = rng.randint(10 ** (places_a - 1), 10**places_a - 1)
        b = rng.randint(10 ** (places_b - 1), 10**places_b - 1)
        da, db = _digits(a, places_a), _digits(b, places_a)
        if all(x + y <= 9 for x, y in zip(da, db, strict=True)):
            return a, b


def _no_borrow_pair(rng: random.Random, places_a: int, places_b: int) -> tuple[int, int]:
    """a − b sin reserva: en cada columna la cifra de arriba ≥ la de abajo."""
    while True:
        a = rng.randint(10 ** (places_a - 1), 10**places_a - 1)
        b = rng.randint(10 ** (places_b - 1), 10**places_b - 1)
        da, db = _digits(a, places_a), _digits(b, places_a)
        if all(x >= y for x, y in zip(da, db, strict=True)) and a != b:
            return a, b


def _has_carry(a: int, b: int) -> bool:
    return any(x + y > 9 for x, y in zip(_digits(a, 4), _digits(b, 4), strict=True))


def _has_borrow(a: int, b: int) -> bool:
    return any(x < y for x, y in zip(_digits(a, 4), _digits(b, 4), strict=True))


def _carry_pair(rng: random.Random, max_total: int) -> tuple[int, int]:
    """Suma de 3 cifras (o 3 + 2) con al menos una reserva y resultado ≤ max_total."""
    while True:
        a = rng.randint(100, max_total - 10)
        b = rng.randint(10, max_total - a)
        if _has_carry(a, b):
            return a, b


def _borrow_pair(rng: random.Random, high: int) -> tuple[int, int]:
    """Resta con al menos un canje, minuendo de 3 cifras ≤ high, resultado > 0."""
    while True:
        a = rng.randint(100, high)
        b = rng.randint(10, a - 1)
        if _has_borrow(a, b):
            return a, b


def _family(rng: random.Random, low: int, high: int, complete: bool) -> Exercise:
    """Familia de operaciones a + b = s. Sin `complete`: dada la suma, calcular una resta.
    Con `complete`: se muestran tres hechos de la familia y falta un número del cuarto."""
    s = rng.randint(max(low, 2), high)
    a = rng.randint(1, s - 1)
    b = s - a
    if not complete:
        sub = rng.choice((a, b))
        return Exercise(f"Si {_n(a)} + {_n(b)} = {_n(s)}, ¿cuánto es {_n(s)} − {_n(sub)}?", s - sub)
    facts = [
        f"{_n(a)} + {_n(b)} = {_n(s)}",
        f"{_n(b)} + {_n(a)} = {_n(s)}",
        f"{_n(s)} − {_n(a)} = {_n(b)}",
    ]
    return Exercise(f"{'; '.join(facts)}; {_n(s)} − ? = {_n(a)}", b)


def _table(rng: random.Random, tables: tuple[int, ...], low: int, high: int) -> Exercise:
    t = rng.choice(tables)
    n = rng.randint(low, high)
    a, b = (t, n) if rng.random() < 0.5 else (n, t)
    return Exercise(f"{a} × {b} = ?", t * n)


def _table_missing(rng: random.Random, tables: tuple[int, ...]) -> Exercise:
    t = rng.choice(tables)
    n = rng.randint(1, 10)
    return Exercise(f"{t} × ? = {t * n}", n)


def _place_digit(rng: random.Random, value: int, places: tuple[str, ...]) -> Exercise:
    """Pregunta la cifra de un lugar (no "¿cuántas decenas tiene?": admite dos respuestas)."""
    index = rng.randrange(len(places))
    digit = (value // 10**index) % 10
    return Exercise(f"¿Qué cifra está en el lugar de las {places[index]} en {_n(value)}?", digit)


_PLACES = ("unidades", "decenas", "centenas", "unidades de mil")


def _compose(parts: list[tuple[int, str, str]]) -> str:
    """[(3, "centena", "centenas"), …] → "3 centenas, 4 decenas y 7 unidades"."""
    words = [f"{n} {one if n == 1 else many}" for n, one, many in parts]
    return ", ".join(words[:-1]) + f" y {words[-1]}" if len(words) > 1 else words[0]


_UNIT_NAMES = (
    ("unidad", "unidades"),
    ("decena", "decenas"),
    ("centena", "centenas"),
    ("unidad de mil", "unidades de mil"),
)


def _compose_number(value: int, places: int) -> Exercise:
    digits = _digits(value, places)
    parts = [(digits[i], *_UNIT_NAMES[i]) for i in reversed(range(places))]
    return Exercise(f"{_compose(parts)}. ¿Qué número es?", value)


def _equality(rng: random.Random, high: int) -> Exercise:
    """a + b = ? + c, todo ≤ high."""
    s = rng.randint(3, high)
    a = rng.randint(1, s - 1)
    c = rng.randint(1, s - 1)
    while c in (a, s - a) and s > 3:
        c = rng.randint(1, s - 1)
    return Exercise(f"{a} + {s - a} = ? + {c}", s - c)


# ---- 1° básico -----------------------------------------------------------------------------


def _1_01(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _next_in_sequence(rng.randint(1, 26), 1)
    if level == 2:
        step = rng.choice((2, 10))
        return _next_in_sequence(step * rng.randint(0, 100 // step - 4), step)
    if rng.random() < 0.5:
        return _next_in_sequence(5 * rng.randint(0, 16), 5)
    return _next_in_sequence(rng.randint(10, 99), -1)


def _1_02(rng: random.Random, level: int) -> Exercise:
    emoji, name, how_many = rng.choice(_OBJECTS)
    if level == 3:
        tens, units = rng.choice([(1, u) for u in range(10)] + [(2, 0)])
        groups = "1 grupo" if tens == 1 else f"{tens} grupos"
        loose = "sueltas" if how_many == "Cuántas" else "sueltos"
        extra = f" y {units} {name} {loose}" if units else ""
        return Exercise(
            f"Hay {groups} de 10 {name}{extra}. ¿{how_many} {name} hay en total?",
            10 * tens + units,
        )
    n = rng.randint(1, 10) if level == 1 else rng.randint(11, 20)
    rows = [emoji * min(5, n - i) for i in range(0, n, 5)]
    return Exercise(f"{' '.join(rows)} ¿{how_many} {name} hay?", n)


def _1_03(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _compare_two(rng, 0, 10)
    if level == 2:
        return _compare_two(rng, 0, 20)
    return _order(rng, 0, 20, allow_four=False)


def _1_04(rng: random.Random, level: int) -> Exercise:
    if level == 3:
        n = rng.randint(3, 20)
        a = rng.randint(1, n - 1)
        return Exercise(f"{n} = {a} + ?", n - a)
    n = rng.randint(2, 10) if level == 1 else rng.randint(11, 20)
    return _missing_addend(rng.randint(1, n - 1), n)


def _1_05(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        n = rng.randint(10, 19)
        return Exercise(f"¿Cuántas unidades tiene el número {n}?", n % 10)
    if level == 2:
        n = rng.randint(10, 20)
        if rng.random() < 0.5:
            return Exercise(f"¿Cuántas decenas tiene el número {n}?", n // 10)
        return Exercise(f"¿Cuántas unidades tiene el número {n}?", n % 10)
    return _compose_number(rng.choice([*range(10, 20), 20]), 2)


def _1_06(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _add(rng.randint(0, 5), rng.randint(0, 5))
    if level == 2:
        return _add(*_sum_to(rng, 6, 10, 9))
    n = rng.randint(2, 10)
    return _missing_addend(rng.randint(1, n - 1), n)


def _1_07(rng: random.Random, level: int) -> Exercise:
    if level == 3:
        n = rng.randint(2, 10)
        return _missing_subtrahend(n, rng.randint(0, n - 1))
    m = rng.randint(1, 5) if level == 1 else rng.randint(6, 10)
    return _sub(m, rng.randint(0, m))


def _1_08(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _add(*_sum_to(rng, 11, 15, 10))
    if level == 2:
        return _add(*_sum_to(rng, 16, 20, 10))
    a, b = _sum_to(rng, 11, 20, 10)
    return _missing_addend(a, a + b)


def _1_09(rng: random.Random, level: int) -> Exercise:
    if level == 3:
        m = rng.randint(11, 20)
        return _missing_subtrahend(m, m - rng.randint(1, 10))
    m = rng.randint(11, 15) if level == 1 else rng.randint(16, 20)
    return _sub(m, rng.randint(1, 10))


def _1_10(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        a = rng.randint(1, 9)
        if rng.random() < 0.5:
            return _missing_addend(a, 10)
        return Exercise(f"? + {a} = 10", 10 - a)
    if level == 2:
        n = rng.randint(1, 10)
        return _add(n, n)
    if rng.random() < 0.5:
        n = rng.randint(1, 9)
        return _add(n, n + 1) if rng.random() < 0.5 else _add(n + 1, n)
    a = rng.choice((8, 9))
    return _add(a, rng.randint(11 - a, 9))


def _1_11(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _family(rng, 2, 10, complete=False)
    if level == 2:
        return _family(rng, 11, 20, complete=False)
    return _family(rng, 5, 20, complete=True)


def _1_13(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        step = rng.choice((1, 2))
        return _next_in_sequence(rng.randint(0, 20 - 4 * step), step)
    if level == 2:
        if rng.random() < 0.5:
            step = rng.choice((1, 2))
            return _next_in_sequence(rng.randint(4 * step, 20), -step)
        return _next_in_sequence(0, 5) if rng.random() < 0.5 else _next_in_sequence(20, -5)
    step = rng.choice((1, 2))
    return _missing_in_sequence(rng, rng.randint(0, 20 - 4 * step), step)


# ---- 2° básico -----------------------------------------------------------------------------


def _2_01(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        step = rng.choice((2, 10))
        return _next_in_sequence(step * rng.randint(0, 100 // step - 4), step)
    if level == 2:
        if rng.random() < 0.5:
            return _next_in_sequence(5 * rng.randint(0, 16), 5)
        return _next_in_sequence(5 * rng.randint(4, 20), -5)
    if rng.random() < 0.5:
        return _next_in_sequence(100 * rng.randint(0, 6), 100)
    return _next_in_sequence(100 * rng.randint(4, 10), -100)


def _2_02(rng: random.Random, level: int) -> Exercise:
    if level == 3:
        return _compose_number(rng.randint(10, 99), 2)
    n = rng.randint(10, 50) if level == 1 else rng.randint(10, 99)
    if rng.random() < 0.5:
        return Exercise(f"¿Cuántas decenas tiene el número {n}?", n // 10)
    return Exercise(f"¿Cuántas unidades tiene el número {n}?", n % 10)


def _2_03(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _compare_two(rng, 0, 50)
    if level == 2:
        return _compare_two(rng, 0, 100)
    return _order(rng, 0, 100, allow_four=True)


def _2_04(rng: random.Random, level: int) -> Exercise:
    d, u = rng.randint(1, 9), rng.randint(1, 9)
    n = 10 * d + u
    if level == 1:
        return Exercise(f"{n} = {10 * d} + ?", u)
    if level == 2:
        return Exercise(f"{n} = ? + {u}", 10 * d)
    d = rng.randint(2, 9)
    n = 10 * d + u
    k = rng.randint(1, d - 1)
    return Exercise(f"{n} = {10 * (d - k)} + ? + {u}", 10 * k)


def _2_06(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        kind = rng.randrange(3)
        n = rng.randint(1, 20)
        if kind == 0:
            return _add(n, 0)
        if kind == 1:
            return _sub(n, 0)
        return _missing_addend(rng.randint(1, 9), 10)
    if level == 2:
        n = rng.randint(1, 10)
        if rng.random() < 0.5:
            return Exercise(f"¿Cuál es el doble de {n}?", 2 * n)
        return Exercise(f"¿Cuál es la mitad de {2 * n}?", n)
    k = rng.choice((1, 2))
    word = "uno" if k == 1 else "dos"
    n = rng.randint(k, 20 - k)
    if rng.random() < 0.5:
        return Exercise(f"¿Qué número es {word} más que {n}?", n + k)
    return Exercise(f"¿Qué número es {word} menos que {n}?", n - k)


def _2_07(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _add(*_no_carry_pair(rng, 2, 1))
    if level == 2:
        return _add(*_no_carry_pair(rng, 2, 2))
    a, b = _no_carry_pair(rng, 2, 2)
    return _missing_addend(a, a + b)


def _2_08(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _sub(*_no_borrow_pair(rng, 2, 1))
    if level == 2:
        return _sub(*_no_borrow_pair(rng, 2, 2))
    a, b = _no_borrow_pair(rng, 2, 2)
    return _missing_subtrahend(a, a - b)


def _2_10(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _family(rng, 5, 20, complete=False)
    if level == 2:
        return _family(rng, 21, 100, complete=False)
    return _family(rng, 10, 100, complete=True)


def _2_11(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        n, k = rng.choice((2, 5)), rng.randint(2, 4)
        return Exercise(f"{' + '.join([str(n)] * k)} = ?", n * k)
    if level == 2:
        n, k = rng.choice((2, 3, 4, 5, 10)), rng.randint(2, 5)
        return Exercise(f"{' + '.join([str(n)] * k)} = {n} × ?", k)
    _, name, how_many = rng.choice(_OBJECTS)
    groups, size = rng.randint(2, 5), rng.choice((2, 5, 10))
    return Exercise(
        f"Hay {groups} grupos de {size} {name}. ¿{how_many} {name} hay en total?", groups * size
    )


def _times_table(t: int) -> Generator:
    def gen(rng: random.Random, level: int) -> Exercise:
        if level == 1:
            return _table(rng, (t,), 1, 5)
        if level == 2:
            return _table(rng, (t,), 6, 10)
        return _table_missing(rng, (t,))

    return gen


def _2_15(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        step = rng.choice((2, 5))
        return _next_in_sequence(step * rng.randint(0, 100 // step - 4), step)
    if level == 2:
        step = rng.choice((2, 5, 10))
        return _next_in_sequence(step * rng.randint(4, 100 // step), -step)
    step = rng.choice((2, 5, 10))
    start = step * rng.randint(0, 100 // step - 4)
    if rng.random() < 0.5:
        return _missing_in_sequence(rng, start, step)
    return _missing_in_sequence(rng, start + 4 * step, -step)


def _2_16(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _equality(rng, 10)
    if level == 2:
        return _equality(rng, 20)
    while True:
        a, b, c, d = (rng.randint(1, 10) for _ in range(4))
        if a + b != c + d:
            break
    small, big = sorted(((a, b), (c, d)), key=sum)
    return Exercise(
        f"¿Cuánto le falta a {small[0]} + {small[1]} para ser igual a {big[0]} + {big[1]}?",
        sum(big) - sum(small),
    )


# ---- 3° básico -----------------------------------------------------------------------------


def _3_01(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        step = rng.choice((5, 10))
        return _next_in_sequence(step * rng.randint(0, 100 // step - 4), step)
    if level == 2:
        if rng.random() < 0.5:
            return _next_in_sequence(100 * rng.randint(0, 6), 100)
        return _next_in_sequence(100 * rng.randint(4, 10), -100)
    step = rng.choice((3, 4))
    return _next_in_sequence(step * rng.randint(0, 20), step)


def _3_02(rng: random.Random, level: int) -> Exercise:
    if level == 3:
        return _compose_number(rng.randint(100, 999), 3)
    n = rng.randint(100, 500) if level == 1 else rng.randint(100, 999)
    return _place_digit(rng, n, _PLACES[:3])


def _3_03(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _compare_two(rng, 100, 500)
    if level == 2:
        return _compare_two(rng, 100, 1000)
    return _order(rng, 100, 1000, allow_four=True)


def _3_04(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        n = rng.choice([x for x in range(11, 100) if x % 10])
        target = (n // 10 + 1) * 10
        return Exercise(f"¿Cuánto le falta a {n} para llegar a {target}?", target - n)
    if level == 2:
        if rng.random() < 0.5:
            n = rng.randint(11, 50)
            return Exercise(f"¿Cuál es el doble de {n}?", 2 * n)
        a, b = rng.randint(11, 49), rng.randint(11, 49)
        ta, tb = a // 10 * 10, b // 10 * 10
        return Exercise(
            f"{a} + {b} = {ta} + {tb} + {a % 10} + {b % 10}. ¿Cuánto es {a} + {b}?", a + b
        )
    if rng.random() < 0.5:
        b = rng.randint(10, 80)
        a = b + rng.randint(2, 19)
        return Exercise(
            f"Para restar {a} − {b}, piensa: ¿cuánto le sumas a {b} para llegar a {a}?", a - b
        )
    b = rng.randint(1, 9)
    a = rng.randint(11, 79)
    return Exercise(f"{a} + {b} + {10 - b} = ?", a + 10)


def _3_05(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _add(*_no_carry_pair(rng, 3, 3))
    if level == 2:
        return _add(*_carry_pair(rng, 999))
    count = rng.choice((3, 4))
    values = [rng.randint(10, 250) for _ in range(count)]
    return Exercise(" + ".join(_n(v) for v in values) + " = ?", sum(values))


def _3_06(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _sub(*_no_borrow_pair(rng, 3, 3))
    if level == 2:
        return _sub(*_borrow_pair(rng, 999))
    a = rng.randint(100, 999)
    b = rng.randint(10, a - 1)
    if rng.random() < 0.5:
        return _missing_subtrahend(a, a - b)
    return Exercise(f"? + {_n(b)} = {_n(a)}", a - b)


def _3_07(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _family(rng, 20, 100, complete=False)
    if level == 2:
        return _family(rng, 101, 1000, complete=False)
    return _family(rng, 100, 1000, complete=True)


def _3_08(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _table(rng, (2, 10), 1, 10)
    if level == 2:
        return _table(rng, (5,), 1, 10)
    return _table_missing(rng, (2, 5, 10))


def _3_09(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _table(rng, (3,), 1, 10)
    if level == 2:
        return _table(rng, (4, 6), 1, 10)
    return _table_missing(rng, (3, 4, 6))


def _3_10(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _table(rng, (7,), 1, 10)
    if level == 2:
        return _table(rng, (8, 9), 1, 10)
    return _table(rng, (2, 3, 4, 5, 6, 7, 8, 9, 10), 1, 10)


def _3_11(rng: random.Random, level: int) -> Exercise:
    divisors = {1: (2, 5, 10), 2: (3, 4, 6), 3: (2, 3, 4, 5, 6, 7, 8, 9, 10)}[level]
    d = rng.choice(divisors)
    q = rng.randint(1, 10)
    p = d * q
    if level == 3 and rng.random() < 0.5:
        return Exercise(f"Si {d} × ? = {p}, ¿cuánto es {p} ÷ {d}?", q)
    if rng.random() < 0.5:
        _, name, how_many = rng.choice(_OBJECTS)
        return Exercise(
            f"Reparte {p} {name} en {d} grupos iguales. ¿{how_many} {name} quedan en cada grupo?",
            q,
        )
    return Exercise(f"{p} ÷ {d} = ?", q)


def _3_14(rng: random.Random, level: int) -> Exercise:
    if level == 3:
        step = rng.choice((1, 2, 5, 10))
        return _next_in_sequence(step * rng.randint(4, 100 // step), -step)
    step = rng.choice((1, 10) if level == 1 else (2, 5))
    return _next_in_sequence(rng.randint(1, 100 - 4 * step), step)


def _3_15(rng: random.Random, level: int) -> Exercise:
    if level in (1, 2):
        b = rng.randint(3, 20) if level == 1 else rng.randint(21, 100)
        a = rng.randint(1, b - 1)
        return Exercise(f"{a} + □ = {b}. ¿Qué número va en el □?", b - a)
    if rng.random() < 0.5:
        a, b = rng.randint(1, 50), rng.randint(1, 50)
        return Exercise(f"□ − {a} = {b}. ¿Qué número va en el □?", a + b)
    a = rng.randint(10, 100)
    b = rng.randint(0, a - 1)
    return Exercise(f"{a} − □ = {b}. ¿Qué número va en el □?", a - b)


def _3_22(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        side = rng.randint(1, 20)
        return Exercise(
            f"Un cuadrado tiene lados de {side} cm. ¿Cuál es su perímetro en cm?", 4 * side
        )
    if level == 2:
        a, b = rng.sample(range(1, 21), 2)
        return Exercise(
            f"Un rectángulo mide {max(a, b)} cm de largo y {min(a, b)} cm de ancho. "
            "¿Cuál es su perímetro en cm?",
            2 * (a + b),
        )
    if rng.random() < 0.5:
        side = rng.randint(1, 20)
        return Exercise(
            f"Un cuadrado tiene un perímetro de {4 * side} cm. ¿Cuánto mide cada lado en cm?",
            side,
        )
    a, b = rng.sample(range(1, 21), 2)
    long, short = max(a, b), min(a, b)
    return Exercise(
        f"Un rectángulo tiene un perímetro de {2 * (a + b)} cm y mide {long} cm de largo. "
        "¿Cuánto mide de ancho en cm?",
        short,
    )


def _3_23(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        kind = rng.randrange(4)
        if kind == 0:
            return Exercise("¿Cuántos gramos hay en 1 kg?", 1000)
        if kind == 1:
            return Exercise("¿Cuántos gramos son medio kilo?", 500)
        if kind == 2:
            return Exercise("¿Cuántos medios kilos se necesitan para formar 1 kg?", 2)
        g = 100 * rng.randint(1, 9)
        return Exercise(f"Tienes {g} g. ¿Cuántos gramos faltan para completar 1 kg?", 1000 - g)
    if level == 2:
        k = rng.randint(1, 9)
        if rng.random() < 0.5:
            return Exercise(f"{k} kg = ? g", 1000 * k)
        return Exercise(f"{_n(1000 * k)} g = ? kg", k)
    k = rng.randint(1, 4)
    g = 100 * rng.randint(1, 9)
    if rng.random() < 0.5:
        return Exercise(
            f"Una bolsa de harina pesa {k} kg y otra pesa {g} g. "
            "¿Cuántos gramos pesan las dos juntas?",
            1000 * k + g,
        )
    return Exercise(
        f"Tenías {k} kg de arroz y usaste {g} g. ¿Cuántos gramos de arroz te quedan?",
        1000 * k - g,
    )


# ---- 4° básico -----------------------------------------------------------------------------


def _4_01(rng: random.Random, level: int) -> Exercise:
    if level in (1, 2):
        n = rng.randint(1000, 5000) if level == 1 else rng.randint(1000, 9999)
        return _place_digit(rng, n, _PLACES)
    n = rng.randint(1000, 9999)
    if rng.random() < 0.5:
        return _compose_number(n, 4)
    th, h, rest = n // 1000 * 1000, (n // 100) % 10 * 100, n % 100
    if h == 0 or rest == 0:
        return _compose_number(n, 4)
    return Exercise(f"{_n(n)} = {_n(th)} + ? + {rest}", h)


def _4_02(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _compare_two(rng, 1000, 5000)
    if level == 2:
        return _compare_two(rng, 1000, 10000)
    return _order(rng, 1000, 10000, allow_four=True)


def _4_03(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        n = rng.randint(2, 50)
        if rng.random() < 0.5:
            return Exercise(f"¿Cuál es el doble de {n}?", 2 * n)
        return Exercise(f"{2 * n} ÷ 2 = ?", n)
    if level == 2:
        n = rng.randint(2, 25)
        return Exercise(f"¿Cuál es el doble del doble de {n}?", 4 * n)
    a = rng.randint(3, 9)
    b = rng.randint(6, 9)
    return Exercise(f"{a} × {b} = {a} × 5 + {a} × {b - 5}. ¿Cuánto es {a} × {b}?", a * b)


def _4_04(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        return _add(*_carry_pair(rng, 1000))
    if level == 2:
        return _sub(*_borrow_pair(rng, 1000))
    a = rng.randint(200, 900)
    b = rng.randint(10, 1000 - a)
    if rng.random() < 0.5:
        return Exercise(
            f"En una biblioteca hay {a} libros y llegan {b} más. ¿Cuántos libros hay ahora?",
            a + b,
        )
    c = rng.randint(10, a + b - 1)
    return Exercise(
        f"En una biblioteca hay {a} libros. Llegan {b} y se prestan {c}. ¿Cuántos libros quedan?",
        a + b - c,
    )


def _4_05(rng: random.Random, level: int) -> Exercise:
    n = rng.randint(2, 999)
    if level == 1:
        kind = rng.randrange(3)
        if kind == 0:
            return Exercise(f"{n} × 0 = ?", 0)
        if kind == 1:
            return Exercise(f"0 × {n} = ?", 0)
        return Exercise(f"{n} × 1 = ?", n)
    if level == 2:
        return Exercise(f"{n} ÷ 1 = ?", n)
    kind = rng.randrange(4)
    if kind == 0:
        return Exercise(f"{n} × ? = {n}", 1)
    if kind == 1:
        return Exercise(f"{n} × ? = 0", 0)
    if kind == 2:
        return Exercise(f"? ÷ 1 = {n}", n)
    return Exercise(f"{n} ÷ ? = {n}", 1)


def _4_06(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        while True:
            m = rng.randint(2, 4)
            a = rng.randint(100, 999)
            if all(d * m <= 9 for d in _digits(a, 3)):
                return Exercise(f"{a} × {m} = ?", a * m)
    if level == 2:
        while True:
            m = rng.randint(2, 9)
            a = rng.randint(100, 999)
            if any(d * m > 9 for d in _digits(a, 3)):
                return Exercise(f"{a} × {m} = ?", a * m)
    m = rng.randint(2, 9)
    if rng.random() < 0.5:
        c = 100 * rng.randint(1, 9)
        return Exercise(f"{c} × {m} = ?", c * m)
    h = 100 * rng.randint(1, 9)
    r = rng.randint(11, 99)
    return Exercise(
        f"{h + r} × {m} = {h} × {m} + {r} × {m}. ¿Cuánto es {h + r} × {m}?", (h + r) * m
    )


def _4_07(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        d = rng.randint(2, 9)
        q = rng.randint(max(2, -(-10 // d)), 10)
        return Exercise(f"{d * q} ÷ {d} = ?", q)
    if level == 2:
        d = rng.randint(2, 9)
        q = rng.randint(11, 99 // d)  # 99 // 9 = 11: siempre hay al menos un cociente
        return Exercise(f"{d * q} ÷ {d} = ?", q)
    while True:
        d = rng.randint(2, 9)
        q = rng.randint(2, 9)
        p = d * q
        if p >= 10 and p // 10 < d:
            return Exercise(f"{p} ÷ {d} = ?", q)


def _4_10(rng: random.Random, level: int) -> Exercise:
    """Fracciones de igual denominador. La respuesta es una fracción (numerador / denominador)."""
    if level == 1:
        d = rng.randint(2, 5)
        a, b = rng.randint(1, d - 1), rng.randint(1, d - 1)
        return Exercise(f"{a}/{d} + {b}/{d} = ?", a + b, d)
    if level == 2:
        d = rng.randint(6, 12)
        if rng.random() < 0.5:
            a, b = rng.randint(1, d - 1), rng.randint(1, d - 1)
            return Exercise(f"{a}/{d} + {b}/{d} = ?", a + b, d)
        a = rng.randint(2, d - 1)
        b = rng.randint(1, a - 1)
        return Exercise(f"{a}/{d} − {b}/{d} = ?", a - b, d)
    d = rng.randint(3, 12)
    if rng.random() < 0.5:
        a = rng.randint(1, d - 2)
        b = rng.randint(1, d - 1 - a)
        return Exercise(f"{a}/{d} + {b}/{d} = ?", a + b, d)
    a = rng.randint(2, d - 1)
    b = rng.randint(1, a - 1)
    return Exercise(f"{a}/{d} − {b}/{d} = ?", a - b, d)


def _4_14(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        step = rng.randint(3, 50)
        if rng.random() < 0.5:
            return _next_in_sequence(rng.randint(1, 500), step)
        return _next_in_sequence(rng.randint(4 * step, 900), -step)
    if level == 2:
        ratio = rng.choice((2, 3, 10))
        start = rng.randint(1, 5 if ratio != 10 else 9)
        values = [start * ratio**i for i in range(4)]
        return Exercise(f"{_seq(values)}, … ¿Qué número sigue?", start * ratio**4)
    inputs = sorted(rng.sample(range(1, 10), 3))
    new = rng.randint(10, 15)
    if rng.random() < 0.5:
        k = rng.randint(2, 20)
        rule = lambda x: x + k  # noqa: E731
    else:
        k = rng.randint(2, 9)
        rule = lambda x: x * k  # noqa: E731
    pairs = "; ".join(f"entra {x}, sale {rule(x)}" for x in inputs)
    return Exercise(
        f"Una máquina cambia números con la misma regla: {pairs}. Si entra {new}, ¿qué sale?",
        rule(new),
    )


def _4_15(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        b = rng.randint(10, 100)
        a = rng.randint(1, b - 1)
        return Exercise(f"{a} + □ = {b}. ¿Qué número va en el □?", b - a)
    if level == 2:
        a = rng.randint(1, 60)
        b = rng.randint(0, 100 - a)
        return Exercise(f"□ − {a} = {b}. ¿Qué número va en el □?", a + b)
    a = rng.randint(1, 50)
    b = rng.randint(a, 100)
    return Exercise(
        f"¿Cuál es el menor número que puede ir en el □ para que sea verdad: □ + {a} > {b}?",
        b - a + 1,
    )


def _4_22(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        h = rng.randint(1, 10)
        if rng.random() < 0.5:
            return Exercise(f"{h} horas = ? minutos", 60 * h)
        return Exercise(f"{60 * h} minutos = ? horas", h)
    if level == 2:
        kind = rng.randrange(4)
        n = rng.randint(2, 10)
        if kind == 0:
            return Exercise(f"{n} semanas = ? días", 7 * n)
        if kind == 1:
            return Exercise(f"{7 * n} días = ? semanas", n)
        if kind == 2:
            return Exercise(f"{n} años = ? meses", 12 * n)
        return Exercise(f"{12 * n} meses = ? años", n)
    if rng.random() < 0.5:
        m = rng.randint(1, 10)
        if rng.random() < 0.5:
            return Exercise(f"{m} minutos = ? segundos", 60 * m)
        return Exercise(f"{60 * m} segundos = ? minutos", m)
    h, m = rng.randint(1, 3), 5 * rng.randint(1, 11)
    hours = "1 hora" if h == 1 else f"{h} horas"
    return Exercise(
        f"Un paseo dura {hours} y {m} minutos. ¿Cuántos minutos dura en total?", 60 * h + m
    )


def _4_23(rng: random.Random, level: int) -> Exercise:
    m = rng.randint(1, 20)
    if level == 1:
        return Exercise(f"{m} m = ? cm", 100 * m)
    if level == 2:
        return Exercise(f"{100 * m} cm = ? m", m)
    m = rng.randint(1, 5)
    cm = rng.randint(10, 95)
    if rng.random() < 0.5:
        return Exercise(
            f"Una cuerda mide {m} m y otra mide {cm} cm. ¿Cuántos cm miden las dos juntas?",
            100 * m + cm,
        )
    return Exercise(
        f"Tienes {m} m de cinta y cortas {cm} cm. ¿Cuántos cm de cinta te quedan?", 100 * m - cm
    )


def _4_24(rng: random.Random, level: int) -> Exercise:
    if level == 1:
        a, b = rng.randint(1, 10), rng.randint(1, 10)
        if a == b:
            return Exercise(f"Un cuadrado tiene lados de {a} cm. ¿Cuál es su área en cm²?", a * a)
        return Exercise(
            f"Un rectángulo mide {max(a, b)} cm de largo y {min(a, b)} cm de ancho. "
            "¿Cuál es su área en cm²?",
            a * b,
        )
    if level == 2:
        a, b = rng.randint(2, 20), rng.randint(2, 20)
        unit = rng.choice(("cm", "m"))
        place = "Un rectángulo" if unit == "cm" else "Una sala rectangular"
        return Exercise(
            f"{place} mide {max(a, b)} {unit} de largo y {min(a, b)} {unit} de ancho. "
            f"¿Cuál es su área en {unit}²?",
            a * b,
        )
    a, b = rng.randint(2, 12), rng.randint(2, 12)
    return Exercise(
        f"Un rectángulo tiene un área de {a * b} cm² y uno de sus lados mide {a} cm. "
        "¿Cuánto mide el otro lado en cm?",
        b,
    )


GENERATORS: dict[str, Generator] = {
    # 1° básico
    "1-01": _1_01,
    "1-02": _1_02,
    "1-03": _1_03,
    "1-04": _1_04,
    "1-05": _1_05,
    "1-06": _1_06,
    "1-07": _1_07,
    "1-08": _1_08,
    "1-09": _1_09,
    "1-10": _1_10,
    "1-11": _1_11,
    "1-13": _1_13,
    # 2° básico
    "2-01": _2_01,
    "2-02": _2_02,
    "2-03": _2_03,
    "2-04": _2_04,
    "2-06": _2_06,
    "2-07": _2_07,
    "2-08": _2_08,
    "2-10": _2_10,
    "2-11": _2_11,
    "2-12": _times_table(2),
    "2-13": _times_table(5),
    "2-14": _times_table(10),
    "2-15": _2_15,
    "2-16": _2_16,
    # 3° básico
    "3-01": _3_01,
    "3-02": _3_02,
    "3-03": _3_03,
    "3-04": _3_04,
    "3-05": _3_05,
    "3-06": _3_06,
    "3-07": _3_07,
    "3-08": _3_08,
    "3-09": _3_09,
    "3-10": _3_10,
    "3-11": _3_11,
    "3-14": _3_14,
    "3-15": _3_15,
    "3-22": _3_22,
    "3-23": _3_23,
    # 4° básico
    "4-01": _4_01,
    "4-02": _4_02,
    "4-03": _4_03,
    "4-04": _4_04,
    "4-05": _4_05,
    "4-06": _4_06,
    "4-07": _4_07,
    "4-10": _4_10,
    "4-14": _4_14,
    "4-15": _4_15,
    "4-22": _4_22,
    "4-23": _4_23,
    "4-24": _4_24,
}


def generate(topic_id: str, rng: random.Random, level: int = 1) -> Exercise | None:
    generator = GENERATORS.get(topic_id)
    return generator(rng, clamp_level(level)) if generator else None
