"""Generadores de ejercicios por tema.

╔══════════════════════════════════════════════════════════════════════════════════════════╗
║  PROVISIONAL: los enunciados y rangos son un punto de partida, no currículo validado.    ║
║  Cada tema de `app/ai/topics.py` tiene su generador; cambiar rangos es seguro.           ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝

Cada generador recibe un `random.Random` ya sembrado (la semilla sale de una función HMAC del
servidor, así que el cliente no puede calcular la respuesta) y devuelve el enunciado y la
respuesta, siempre un entero.
"""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Exercise:
    text: str
    answer: int


Generator = Callable[[random.Random], Exercise]


def _after(low: int, high: int) -> Generator:
    def gen(rng: random.Random) -> Exercise:
        n = rng.randint(low, high)
        return Exercise(f"¿Qué número viene después del {n}?", n + 1)

    return gen


def _sumas_hasta_20(rng: random.Random) -> Exercise:
    a = rng.randint(1, 19)
    b = rng.randint(1, 20 - a)
    return Exercise(f"{a} + {b} = ?", a + b)


def _restas_hasta_20(rng: random.Random) -> Exercise:
    a = rng.randint(2, 20)
    b = rng.randint(1, a - 1)
    return Exercise(f"{a} − {b} = ?", a - b)


def _comparar_numeros(rng: random.Random) -> Exercise:
    a = rng.randint(0, 99)
    b = rng.choice([n for n in range(0, 100) if n != a])
    return Exercise(f"¿Cuál es el número mayor: {a} o {b}?", max(a, b))


def _patrones_simples(rng: random.Random) -> Exercise:
    start = rng.randint(1, 10)
    step = rng.randint(1, 5)
    seq = ", ".join(str(start + i * step) for i in range(3))
    return Exercise(f"{seq}, … ¿Qué número sigue?", start + 3 * step)


def _sumas_con_reserva(rng: random.Random) -> Exercise:
    while True:
        a, b = rng.randint(11, 89), rng.randint(11, 89)
        if a % 10 + b % 10 >= 10:
            return Exercise(f"{a} + {b} = ?", a + b)


def _restas_con_canje(rng: random.Random) -> Exercise:
    while True:
        a = rng.randint(21, 99)
        b = rng.randint(11, a - 1)
        if b % 10 > a % 10:
            return Exercise(f"{a} − {b} = ?", a - b)


def _tablas_2_5_10(rng: random.Random) -> Exercise:
    t, n = rng.choice((2, 5, 10)), rng.randint(1, 10)
    return Exercise(f"{t} × {n} = ?", t * n)


def _dobles_y_mitades(rng: random.Random) -> Exercise:
    n = rng.randint(1, 50)
    if rng.random() < 0.5:
        return Exercise(f"¿Cuál es el doble de {n}?", 2 * n)
    return Exercise(f"¿Cuál es la mitad de {2 * n}?", n)


def _tablas_de_multiplicar(rng: random.Random) -> Exercise:
    a, b = rng.randint(2, 9), rng.randint(2, 10)
    return Exercise(f"{a} × {b} = ?", a * b)


def _division_basica(rng: random.Random) -> Exercise:
    d, q = rng.randint(2, 9), rng.randint(1, 10)
    return Exercise(f"{d * q} ÷ {d} = ?", q)


def _fracciones_simples(rng: random.Random) -> Exercise:
    if rng.random() < 0.5:
        n = rng.randint(1, 5)
        return Exercise(f"¿Cuántas mitades (1/2) hay en {n} enteros?", 2 * n)
    n = rng.randint(1, 3)
    return Exercise(f"¿Cuántos cuartos (1/4) hay en {n} enteros?", 4 * n)


def _perimetro_figuras(rng: random.Random) -> Exercise:
    a, b = rng.randint(2, 12), rng.randint(2, 12)
    return Exercise(
        f"Un rectángulo mide {a} cm de largo y {b} cm de ancho. ¿Cuánto mide su perímetro (en cm)?",
        2 * (a + b),
    )


def _problemas_de_dos_pasos(rng: random.Random) -> Exercise:
    a, b = rng.randint(10, 40), rng.randint(5, 20)
    c = rng.randint(1, min(15, a + b - 1))
    return Exercise(
        f"Tienes {a} láminas. Compras {b} más y luego regalas {c}. ¿Cuántas láminas te quedan?",
        a + b - c,
    )


def _multiplicacion_dos_cifras(rng: random.Random) -> Exercise:
    a, b = rng.randint(12, 49), rng.randint(2, 9)
    return Exercise(f"{a} × {b} = ?", a * b)


def _division_con_resto(rng: random.Random) -> Exercise:
    d, q = rng.randint(2, 9), rng.randint(5, 30)
    r = rng.randint(1, d - 1)
    return Exercise(f"{d * q + r} ÷ {d}: ¿cuál es el cociente (sin el resto)?", q)


def _fracciones_equivalentes(rng: random.Random) -> Exercise:
    d = rng.choice((2, 3, 4, 5))
    n = rng.randint(1, d - 1)
    k = rng.randint(2, 4)
    return Exercise(f"{n}/{d} = ?/{d * k}", n * k)


def _area_y_perimetro(rng: random.Random) -> Exercise:
    a, b = rng.randint(3, 15), rng.randint(3, 15)
    return Exercise(
        f"Un rectángulo mide {a} cm por {b} cm. ¿Cuál es su área (en cm²)?",
        a * b,
    )


GENERATORS: dict[str, Generator] = {
    # 1° básico
    "contar_hasta_100": _after(1, 99),
    "sumas_hasta_20": _sumas_hasta_20,
    "restas_hasta_20": _restas_hasta_20,
    "comparar_numeros": _comparar_numeros,
    "patrones_simples": _patrones_simples,
    # 2° básico
    "numeros_hasta_1000": _after(100, 998),
    "sumas_con_reserva": _sumas_con_reserva,
    "restas_con_canje": _restas_con_canje,
    "tablas_del_2_5_10": _tablas_2_5_10,
    "dobles_y_mitades": _dobles_y_mitades,
    # 3° básico
    "tablas_de_multiplicar": _tablas_de_multiplicar,
    "division_basica": _division_basica,
    "fracciones_simples": _fracciones_simples,
    "perimetro_figuras": _perimetro_figuras,
    "problemas_de_dos_pasos": _problemas_de_dos_pasos,
    # 4° básico
    "numeros_hasta_10000": _after(1000, 9998),
    "multiplicacion_dos_cifras": _multiplicacion_dos_cifras,
    "division_con_resto": _division_con_resto,
    "fracciones_equivalentes": _fracciones_equivalentes,
    "area_y_perimetro": _area_y_perimetro,
}


def generate(topic_id: str, rng: random.Random) -> Exercise | None:
    generator = GENERATORS.get(topic_id)
    return generator(rng) if generator else None
