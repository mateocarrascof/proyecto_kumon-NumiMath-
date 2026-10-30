"""Proveedor de IA SIMULADO: determinista, sin red y sin claves.

Sirve para desarrollar y probar todo el flujo (filtros, límites, streaming) sin un modelo real.
Reconoce las formas de enunciado que producen los generadores del catálogo
(`app/exercises/generators.py`) y explica paso a paso cada una, con UN PASO POR LÍNEA (el mismo
formato que `prompt.py` pide al modelo real); si no reconoce el texto, responde con una guía
genérica del tema. No usa `eval`: las cuentas se hacen con un evaluador propio.
Permite inyectar un guion (`script`) para probar cómo reacciona el servidor ante salidas
inseguras o lentas.

Solo afecta al modo `AI_PROVIDER=mock`; el prompt de un proveedor real está en `prompt.py`.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator, Callable, Sequence
from fractions import Fraction

from app.ai.provider import MathPrompt
from app.ai.topics import get_topic

_WORDS_PER_CHUNK = 3
_OPERATION = re.compile(r"(\d{1,7})\s*([+\-×x*÷/])\s*(\d{1,7})")
# Ánimo final: no da por hecho que el niño ya entendió.
_END = "¡Tú puedes!"


# ---- Utilidades ------------------------------------------------------------------------------


def _n(value: int | Fraction) -> str:
    """Entero con punto de miles (4.520), como en los enunciados."""
    return f"{int(value):,}".replace(",", ".")


def _normalize(text: str) -> str:
    text = (
        text.replace("...", "…")
        .replace("−", "-")
        .replace("–", "-")
        .replace("□", "?")
        .replace("️", "")
    )
    text = re.sub(r"(?<=\d)\.(?=\d{3}(?!\d))", "", text)  # 2.000 → 2000
    return re.sub(r"\s+", " ", text).strip()


def _parts(value: int) -> list[int]:
    """345 → [300, 40, 5] (sin ceros)."""
    digits = str(value)
    size = len(digits)
    return [int(d) * 10 ** (size - i - 1) for i, d in enumerate(digits) if d != "0"]


def _count_between(start: int, end: int) -> str:
    """Conteo corto de start a end (solo si son pocos pasos)."""
    if 0 < end - start <= 6:
        return ", ".join(_n(v) for v in range(start + 1, end + 1)) + "."
    return ""


# ---- Evaluador de expresiones (sin eval) -----------------------------------------------------

_TOKEN = re.compile(r"\d+|\?|[+\-×x*÷/]")
_OPS = {"x": "×", "*": "×", "/": "÷"}

Term = Fraction | None  # None = el número que falta


def _tokens(side: str) -> tuple[list[Term], list[str]] | None:
    """'20 + ? + 9' → ([20, None, 9], ['+', '+']). None si no es una expresión simple."""
    raw = _TOKEN.findall(side)
    if "".join(raw) != side.replace(" ", "") or not raw or len(raw) % 2 == 0:
        return None
    nums: list[Term] = []
    ops: list[str] = []
    for i, tok in enumerate(raw):
        is_num = tok.isdigit() or tok == "?"
        if (i % 2 == 0) != is_num:
            return None
        if i % 2 == 0:
            nums.append(None if tok == "?" else Fraction(int(tok)))
        else:
            ops.append(_OPS.get(tok, tok))
    return nums, ops


def _evaluate(nums: list[Fraction], ops: list[str]) -> tuple[Fraction, list[str]] | None:
    """Valor y pasos ("4 × 5 = 20", "20 + 8 = 28"): primero × y ÷, luego + y −."""
    values = [nums[0]]
    pending: list[str] = []
    steps: list[str] = []
    for op, num in zip(ops, nums[1:], strict=True):
        if op in "×÷":
            left = values[-1]
            if op == "÷" and num == 0:
                return None
            result = left * num if op == "×" else left / num
            if result.denominator != 1:
                return None
            steps.append(f"{_n(left)} {op} {_n(num)} = {_n(result)}")
            values[-1] = result
        else:
            pending.append(op)
            values.append(num)
    total = values[0]
    for op, num in zip(pending, values[1:], strict=True):
        result = total + num if op == "+" else total - num
        steps.append(f"{_n(total)} {op} {_n(num)} = {_n(result)}")
        total = result
    return total, steps


def _solve(nums: list[Term], ops: list[str], target: Fraction) -> int | None:
    """El entero ≥ 0 que hace que la expresión valga `target` (búsqueda acotada)."""

    def value(x: int) -> Fraction | None:
        filled = [Fraction(x) if n is None else n for n in nums]
        out = _evaluate(filled, ops)
        return out[0] if out else None

    v0, v1 = value(0), value(1)
    if v0 is not None and v1 is not None and v1 != v0 and value(2) == 2 * v1 - v0:
        x = (target - v0) / (v1 - v0)  # lineal: una sola cuenta
        return int(x) if x.denominator == 1 and x >= 0 and value(int(x)) == target else None
    for x in range(0, 100_001):
        if value(x) == target:
            return x
    return None


# ---- Explicaciones por familia ---------------------------------------------------------------
# Cada explicación es una lista de LÍNEAS: un paso (una cuenta) por línea, frases cortas.

Lines = list[str]


def _steps(calcs: list[str]) -> Lines:
    """Rótulos para varias cuentas seguidas: Primero / Luego… / Al final (sirve con 2 o con 5)."""
    if len(calcs) <= 1:
        return list(calcs)
    labels = ["Primero", *["Luego"] * (len(calcs) - 2), "Al final"]
    return [f"{label}: {calc}" for label, calc in zip(labels, calcs, strict=True)]


def _by_parts(a: int, parts: list[int], op: str) -> tuple[Lines, int]:
    """a + 100, + 50, + 5 (o con -), una cuenta por línea."""
    calcs = []
    total = a
    for p in parts:
        result = total + p if op == "+" else total - p
        calcs.append(f"{_n(total)} {op} {_n(p)} = {_n(result)}")
        total = result
    return _steps(calcs), total


def _explain_sum(a: int, b: int) -> Lines:
    r = a + b
    lines = [f"¡Vamos a sumar {_n(a)} + {_n(b)}!"]
    if b == 0:
        lines.append("Si no agregas nada, el número queda igual.")
    elif b <= 10:
        lines.append(f"Empieza en {_n(a)} y cuenta {_n(b)} hacia adelante.")
        if count := _count_between(a, r):
            lines.append(count)
    else:
        parts = _parts(b)
        if len(parts) > 1:
            lines.append(f"Separa {_n(b)} en {' + '.join(_n(p) for p in parts)}.")
        lines += _by_parts(a, parts, "+")[0]
    lines.append(f"¡Así se llega a {_n(r)}!")
    return lines


def _explain_sub(a: int, b: int) -> Lines:
    if b > a:
        return [
            f"Esta resta pide quitar {_n(b)} a {_n(a)}.",
            f"Pero {_n(b)} es más grande.",
            "Revisa el ejercicio con calma y lo vemos juntos.",
        ]
    r = a - b
    lines = [f"¡Vamos a restar {_n(a)} - {_n(b)}!"]
    if b == 0:
        lines.append("Si no quitas nada, el número queda igual.")
    elif b <= 10:
        lines.append(f"Empieza en {_n(a)} y cuenta {_n(b)} hacia atrás.")
    else:
        parts = _parts(b)
        if len(parts) > 1:
            lines.append(f"Separa {_n(b)} en {' + '.join(_n(p) for p in parts)}.")
            lines.append("Quita una parte cada vez.")
        lines += _by_parts(a, parts, "-")[0]
    lines.append(f"¡Así se llega a {_n(r)}!")
    return lines


def _explain_mul(a: int, b: int) -> Lines:
    r = a * b
    lines = [f"¡Vamos a multiplicar {_n(a)} × {_n(b)}!"]
    if a == 0 or b == 0:
        lines.append("Cualquier número multiplicado por 0 da 0.")
    elif b == 1 or a == 1:
        lines.append("Multiplicar por 1 deja el número igual.")
    else:
        lines.append(f"Significa juntar {_n(b)} grupos de {_n(a)}.")
        if b <= 5 and a <= 20:
            lines.append(f"{' + '.join([_n(a)] * b)} = {_n(r)}")
        elif a >= 10 and b < 10 and len(_parts(a)) > 1:
            parts = _parts(a)
            lines.append(f"Separa {_n(a)} en {' + '.join(_n(p) for p in parts)}.")
            lines += _steps([f"{_n(p)} × {b} = {_n(p * b)}" for p in parts])
            lines.append(f"Junta todo: {' + '.join(_n(p * b) for p in parts)} = {_n(r)}")
    lines.append(f"¡Así se llega a {_n(r)}!")
    return lines


def _explain_div(a: int, b: int) -> Lines:
    if b == 0:
        return ["No se puede repartir en cero grupos.", "Revisa el ejercicio y lo vemos juntos."]
    q, rest = divmod(a, b)
    lines = [f"¡Vamos a dividir {_n(a)} ÷ {_n(b)}!"]
    if b == 1:
        lines.append("Si repartes en 1 solo grupo, ese grupo se queda con todo.")
    else:
        lines.append(f"Reparte {_n(a)} en {_n(b)} grupos iguales.")
        if not rest:
            lines.append(f"Piensa: ¿qué número por {_n(b)} da {_n(a)}?")
            lines.append(f"{_n(b)} × {_n(q)} = {_n(a)}")
    tail = f" y sobran {_n(rest)}" if rest else ""
    lines.append(f"A cada grupo le tocan {_n(q)}{tail}.")
    return lines


_SIMPLE: dict[str, Callable[[int, int], Lines]] = {
    "+": _explain_sum,
    "-": _explain_sub,
    "×": _explain_mul,
    "÷": _explain_div,
}


def _explain_expression(nums: list[Fraction], ops: list[str]) -> Lines | None:
    """Una cuenta sin incógnita: a op b, o varias seguidas."""
    if len(ops) == 1:
        return _SIMPLE[ops[0]](int(nums[0]), int(nums[1]))
    out = _evaluate(nums, ops)
    if out is None:
        return None
    value, steps = out
    lines = []
    if set(ops) == {"+"} and len(set(nums)) == 1:
        n, k = _n(nums[0]), len(nums)
        lines.append(f"Sumas {k} veces el {n}.")
        lines.append(f"Es lo mismo que {n} × {k}.")
    elif "×" in ops and ("+" in ops or "-" in ops):
        lines.append("Primero se multiplica y después se suma.")
    else:
        lines.append("Vamos de a dos números.")
    lines += _steps(steps)
    lines.append(f"¡Así se llega a {_n(value)}!")
    return lines


def _explain_unknown(nums: list[Term], ops: list[str], target: Fraction) -> Lines | None:
    """La parte con el número que falta debe valer `target`."""
    if len(ops) == 1:
        op = ops[0]
        t = int(target)
        unknown_first = nums[0] is None
        known = int(nums[1] if unknown_first else nums[0])  # type: ignore[arg-type]
        if op == "+":
            return _missing_to_reach(known, t)
        if op == "-" and not unknown_first:
            x = known - t
            return [
                f"A {_n(known)} le quitas un número y quedan {_n(t)}.",
                f"¿Cuánto quitaste? {_n(known)} - {_n(t)} = {_n(x)}",
                f"Comprueba: {_n(known)} - {_n(x)} = {_n(t)}",
                f"El número que falta es {_n(x)}.",
            ]
        if op == "-":
            x = t + known
            return [
                f"A un número le quitas {_n(known)} y quedan {_n(t)}.",
                f"Haz la cuenta al revés: {_n(t)} + {_n(known)} = {_n(x)}",
                f"Comprueba: {_n(x)} - {_n(known)} = {_n(t)}",
                f"El número que falta es {_n(x)}.",
            ]
        if op == "×":
            if t == 0:
                return [
                    f"Para que {_n(known)} por un número dé 0, ese número tiene que ser 0.",
                    "Cualquier número por 0 da 0.",
                    "El número que falta es 0.",
                ]
            if t == known:
                return [
                    "Multiplicar por 1 deja el número igual.",
                    f"{_n(known)} × 1 = {_n(known)}",
                    "El número que falta es 1.",
                ]
            x = t // known
            return [
                f"Piensa en la tabla del {_n(known)}.",
                f"¿Cuántas veces {_n(known)} hacen {_n(t)}?",
                f"{_n(known)} × {_n(x)} = {_n(t)}",
                f"El número que falta es {_n(x)}.",
            ]
        if op == "÷" and unknown_first:
            x = t * known
            if known == 1:
                return ["Dividir por 1 deja el número igual.", f"El número que falta es {_n(x)}."]
            return [
                f"Un número repartido en {_n(known)} da {_n(t)}.",
                f"Haz la cuenta al revés: {_n(t)} × {_n(known)} = {_n(x)}",
                f"El número que falta es {_n(x)}.",
            ]
        if op == "÷" and t:
            if t == known:
                return [
                    f"Si {_n(known)} se reparte y queda igual, se repartió en 1 grupo.",
                    "El número que falta es 1.",
                ]
            x = known // t
            return [
                f"¿En cuántos grupos se reparte {_n(known)} para que a cada uno le toquen {_n(t)}?",
                f"{_n(known)} ÷ {_n(t)} = {_n(x)}",
                f"El número que falta es {_n(x)}.",
            ]
    if set(ops) == {"+"}:
        known_nums = [int(n) for n in nums if n is not None]
        total = sum(known_nums)
        if int(target) - total < 0:
            return None
        return [
            f"Los números que ya están suman {' + '.join(_n(k) for k in known_nums)} = {_n(total)}",
            *_missing_to_reach(total, int(target)),
        ]
    x = _solve(nums, ops, target)
    if x is None:
        return None
    return [
        f"Prueba con distintos números hasta que la cuenta dé {_n(target)}.",
        f"El número que falta es {_n(x)}.",
    ]


def _missing_to_reach(start: int, end: int) -> Lines:
    x = end - start
    lines = [f"Piensa: ¿cuánto le falta a {_n(start)} para llegar a {_n(end)}?"]
    if count := _count_between(start, end):
        lines.append(f"Cuenta desde {_n(start)}: {count}")
    else:
        lines.append(f"Haz la resta: {_n(end)} - {_n(start)} = {_n(x)}")
    lines.append(f"{'Falta' if x == 1 else 'Faltan'} {_n(x)}.")
    lines.append(f"Comprueba: {_n(start)} + {_n(x)} = {_n(end)}")
    lines.append(f"El número que falta es {_n(x)}.")
    return lines


def _explain_equation(text: str) -> Lines | None:
    if text.count("=") != 1 or text.count("?") > 1:
        return None
    left, right = (s.strip() for s in text.split("="))
    lt, rt = _tokens(left), _tokens(right)
    if lt is None or rt is None:
        return None
    if left == "?":
        lt, rt = rt, lt
    l_nums, l_ops = lt
    r_nums, r_ops = rt
    if r_nums == [None] and None not in l_nums:
        return _explain_expression(l_nums, l_ops)  # type: ignore[arg-type]
    if None in r_nums:
        (l_nums, l_ops), (r_nums, r_ops) = (r_nums, r_ops), (l_nums, l_ops)
    if None in r_nums or None not in l_nums:
        return None
    known = _evaluate(r_nums, r_ops)  # type: ignore[arg-type]
    if known is None:
        return None
    target, steps = known
    intro: Lines = []
    if steps:
        intro = [
            "Los dos lados del = deben valer lo mismo.",
            "Primero resuelve el lado completo:",
            *steps,
        ]
    body = _explain_unknown(l_nums, l_ops, target)
    return intro + body if body else None


def _explain_fraction(text: str) -> Lines | None:
    m = re.fullmatch(r"(\d+)/(\d+) ([+-]) (\d+)/(\d+) = \?", text)
    if not m or m.group(2) != m.group(5):
        return None
    a, d, op, b = int(m.group(1)), int(m.group(2)), m.group(3), int(m.group(4))
    r = a + b if op == "+" else a - b
    verb = "Suma" if op == "+" else "Resta"
    lines = [
        f"Las dos fracciones tienen el mismo denominador: {d}.",
        f"El entero está partido en {d} partes iguales.",
        f"{verb} solo los numeradores, los de arriba: {a} {op} {b} = {r}",
        f"El denominador se queda igual: {d}.",
        f"El resultado es {r} sobre {d}.",
    ]
    if r == d:
        lines.append(f"{d} partes de {d} forman 1 entero completo.")
    return lines


def _explain_family(text: str) -> Lines | None:
    m = re.fullmatch(r"Si (.+?) = (\d+), ¿cuánto es (.+?)\?", text)
    if not m:
        return None
    first, total, question = m.group(1), Fraction(int(m.group(2))), m.group(3)
    ft, qt = _tokens(first), _tokens(question)
    if ft is None or qt is None or None in qt[0]:
        return None
    out = _evaluate(qt[0], qt[1])  # type: ignore[arg-type]
    if out is None:
        return None
    answer = out[0]
    f_nums, f_ops = ft
    if None in f_nums:
        x = _solve(f_nums, f_ops, total)
        if x is None:
            return None
        f_nums = [Fraction(x) if n is None else n for n in f_nums]
    shown = " ".join(
        part for pair in zip([_n(n) for n in f_nums], [*f_ops, ""], strict=True) for part in pair
    ).strip()
    pair = "Multiplicar y dividir" if "×" in f_ops else "Sumar y restar"
    return [
        f"{pair} son operaciones hermanas.",
        "Una deshace lo que hace la otra.",
        f"Sabemos que {shown} = {_n(total)}",
        f"Con los mismos números: {question.strip()} = {_n(answer)}",
        f"El resultado es {_n(answer)}.",
    ]


def _explain_sequence(text: str) -> Lines | None:
    m = re.fullmatch(
        r"([\d, ?]+?),? (?:… )?(?:\. )?¿Qué número (sigue|falta)\?", text.replace(". ¿", " ¿")
    )
    if not m:
        return None
    items = [s.strip() for s in m.group(1).split(",") if s.strip()]
    asks_next = m.group(2) == "sigue"
    if asks_next:
        items.append("?")
    if items.count("?") != 1 or len(items) < 3:
        return None
    idx = items.index("?")
    vals = [None if s == "?" else int(s) for s in items]
    known = [(i, v) for i, v in enumerate(vals) if v is not None]
    diffs = {
        (b - a) // (j - i) for (i, a), (j, b) in zip(known, known[1:], strict=False) if j - i == 1
    }
    word = "sigue" if asks_next else "falta"
    if len(diffs) == 1:
        step = diffs.pop()
        prev = vals[idx - 1] if idx > 0 else None
        answer = prev + step if prev is not None else vals[idx + 1] - step  # type: ignore[operator]
        how = f"Suben de {step} en {step}" if step > 0 else f"Bajan de {-step} en {-step}"
        lines = ["Mira cómo cambian los números.", f"{how}."]
        if prev is not None:
            lines.append(f"{_n(prev)} {'+' if step > 0 else '-'} {abs(step)} = {_n(answer)}")
        lines.append(f"El número que {word} es {_n(answer)}.")
        return lines
    ratios = {b // a for (i, a), (j, b) in zip(known, known[1:], strict=False) if a and b % a == 0}
    if asks_next and len(ratios) == 1 and vals[idx - 1] is not None:
        ratio = ratios.pop()
        answer = vals[idx - 1] * ratio  # type: ignore[operator]
        return [
            "Mira cómo cambian los números.",
            f"Cada uno es el anterior multiplicado por {ratio}.",
            f"{_n(vals[idx - 1])} × {ratio} = {_n(answer)}",  # type: ignore[arg-type]
            f"El número que sigue es {_n(answer)}.",
        ]
    return None


def _explain_words(text: str) -> Lines | None:
    """Enunciados con palabras: una regla por forma."""
    if m := re.fullmatch(r"¿Cuál es el número (mayor|menor): (\d+) o (\d+)\?", text):
        kind, a, b = m.group(1), int(m.group(2)), int(m.group(3))
        pick = max(a, b) if kind == "mayor" else min(a, b)
        return [
            "Mira primero cuántas cifras tiene cada número.",
            "Si tienen las mismas, compara cifra por cifra desde la izquierda.",
            f"Entre {_n(a)} y {_n(b)}, el {kind} es {_n(pick)}.",
        ]
    if m := re.fullmatch(
        r"Ordena (.+) de menor a mayor\. ¿Qué número queda (al medio|segundo)\?", text
    ):
        nums = sorted(int(x) for x in re.findall(r"\d+", m.group(1)))
        answer = nums[1] if m.group(2) == "segundo" or len(nums) == 3 else nums[len(nums) // 2]
        return [
            "Ordena empezando por el más chico:",
            ", ".join(_n(v) for v in nums),
            f"El que queda {m.group(2)} es {_n(answer)}.",
        ]
    if m := re.fullmatch(r"¿Cuántas (unidades|decenas) tiene el número (\d+)\?", text):
        n = int(m.group(2))
        tens, units = divmod(n, 10)
        answer = units if m.group(1) == "unidades" else tens
        return [
            f"{_n(n)} se forma con {tens} {'decena' if tens == 1 else 'decenas'} "
            f"y {units} {'unidad' if units == 1 else 'unidades'}.",
            "La cifra de la derecha son las unidades.",
            "La de la izquierda son las decenas.",
            f"La respuesta es {answer}.",
        ]
    places = r"(unidades de mil|centenas|decenas|unidades)"
    if m := re.fullmatch(rf"¿Qué cifra está en el lugar de las {places} en (\d+)\?", text):
        place, n = m.group(1), int(m.group(2))
        names = ["unidades", "decenas", "centenas", "unidades de mil"]
        digits = [(n // 10**i) % 10 for i in range(len(str(n)))]
        answer = digits[names.index(place)]
        return [
            f"Separa {_n(n)} por lugares, de izquierda a derecha:",
            *(f"{d} en las {names[i]}" for i, d in reversed(list(enumerate(digits)))),
            f"En el lugar de las {place} está el {answer}.",
        ]
    if text.endswith("¿Qué número es?"):
        units = {"unidad de mil": 1000, "unidades de mil": 1000, "centena": 100, "centenas": 100,
                 "decena": 10, "decenas": 10, "unidad": 1, "unidades": 1}  # fmt: skip
        found = re.findall(
            r"(\d+) (unidades de mil|unidad de mil|centenas?|decenas?|unidad(?:es)?)\b", text
        )
        if not found:
            return None
        values = [int(k) * units[name] for k, name in found]
        total = _n(sum(values))
        return [
            *(
                f"{k} {name} {'es' if k == '1' else 'son'} {_n(v)}"
                for (k, name), v in zip(found, values, strict=True)
            ),
            f"Junta todo: {' + '.join(_n(v) for v in values)} = {total}",
            f"El número es {total}.",
        ]
    if m := re.fullmatch(r"([^\w\s¿?]+(?: [^\w\s¿?]+)*) ¿(Cuánt\w+) (\w+) hay\?", text):
        rows = m.group(1).split(" ")
        total = sum(len(r) for r in rows)
        full = [r for r in rows if len(r) == 5]
        lines = []
        if len(full) >= 2:
            lines.append(f"Hay {len(full)} filas de 5.")
            lines.append(
                f"Cuenta de 5 en 5: {', '.join(str(5 * (i + 1)) for i in range(len(full)))}."
            )
            if loose := _count_between(5 * len(full), total):
                lines.append(f"Sigue de a uno con las que quedan: {loose}")
        else:
            lines.append("Toca cada una con el dedo mientras cuentas.")
            lines.append("No te saltes ninguna.")
        lines.append(f"Hay {total} {m.group(3)}.")
        return lines
    groups_re = r"Hay (\d+) grupos? de (\d+) (\w+)(?: y (\d+) \w+ suelt[oa]s?)?\."
    if m := re.fullmatch(rf"{groups_re} ¿Cuánt\w+ \w+ hay en total\?", text):
        groups, size, name = int(m.group(1)), int(m.group(2)), m.group(3)
        loose = int(m.group(4) or 0)
        if size == 10:
            tens = groups * 10
            are = "decena es" if groups == 1 else "decenas son"
            lines = ["Cada grupo de 10 es una decena.", f"{groups} {are} {tens}."]
            if loose:
                lines.append(f"Suma las sueltas: {tens} + {loose} = {tens + loose}")
            lines.append(f"Hay {tens + loose} {name} en total.")
            return lines
        total = groups * size
        return [
            f"Son {groups} grupos con {size} {name} cada uno.",
            f"Puedes sumar: {' + '.join([str(size)] * groups)} = {total}",
            f"O multiplicar: {groups} × {size} = {total}",
            f"Hay {total} {name} en total.",
        ]
    if m := re.fullmatch(r"Reparte (\d+) (\w+) en (\d+) grupos iguales\. .*", text):
        p, name, d = int(m.group(1)), m.group(2), int(m.group(3))
        q = p // d
        return [
            f"Repartir en partes iguales es dividir: {p} ÷ {d}.",
            f"Piensa: ¿qué número por {d} da {p}?",
            f"{d} × {q} = {p}",
            f"En cada grupo quedan {q} {name}.",
        ]
    if m := re.fullmatch(r"¿Cuál es el doble del doble de (\d+)\?", text):
        n = int(m.group(1))
        return [
            "El doble es sumar el número dos veces.",
            *_steps([f"{n} + {n} = {2 * n}", f"{2 * n} + {2 * n} = {4 * n}"]),
            f"La respuesta es {4 * n}.",
        ]
    if m := re.fullmatch(r"¿Cuál es el doble de (\d+)\?", text):
        n = int(m.group(1))
        return [
            "El doble es sumar el número dos veces.",
            f"{n} + {n} = {2 * n}",
            f"La respuesta es {2 * n}.",
        ]
    if m := re.fullmatch(r"¿Cuál es la mitad de (\d+)\?", text):
        n = int(m.group(1))
        return [
            "La mitad es repartir en 2 partes iguales.",
            f"{n} ÷ 2 = {n // 2}",
            f"Comprueba: {n // 2} + {n // 2} = {n}",
            f"La respuesta es {n // 2}.",
        ]
    if m := re.fullmatch(r"¿Qué número es (uno|dos) (más|menos) que (\d+)\?", text):
        k = 1 if m.group(1) == "uno" else 2
        n = int(m.group(3))
        r = n + k if m.group(2) == "más" else n - k
        way = "hacia adelante" if m.group(2) == "más" else "hacia atrás"
        return [f"Empieza en {n} y cuenta {k} {way}.", f"La respuesta es {r}."]
    if m := re.fullmatch(r"¿Cuánto le falta a (\d+) para llegar a (\d+)\?", text):
        return _missing_to_reach(int(m.group(1)), int(m.group(2)))
    if m := re.fullmatch(
        r"Para restar (\d+) - (\d+), piensa: ¿cuánto le sumas a \d+ para llegar a \d+\?", text
    ):
        a, b = int(m.group(1)), int(m.group(2))
        return [*_missing_to_reach(b, a), f"Entonces {a} - {b} = {a - b}"]
    if m := re.fullmatch(
        r"¿Cuánto le falta a (\d+) \+ (\d+) para ser igual a (\d+) \+ (\d+)\?", text
    ):
        a, b, c, d = (int(g) for g in m.groups())
        s1, s2 = a + b, c + d
        low, high = min(s1, s2), max(s1, s2)
        return [
            "Calcula cada lado:",
            f"{a} + {b} = {s1}",
            f"{c} + {d} = {s2}",
            f"¿Cuánto le falta a {low} para llegar a {high}?",
            f"{high} - {low} = {high - low}",
            f"La respuesta es {high - low}.",
        ]
    if m := re.fullmatch(r"(.+?) = (.+?)\. ¿Cuánto es (.+?)\?", text):
        parts = _tokens(m.group(2))
        if parts and None not in parts[0]:
            out = _evaluate(parts[0], parts[1])  # type: ignore[arg-type]
            if out:
                value, steps = out
                return [
                    f"Ya separaste {m.group(1)} en partes más fáciles:",
                    m.group(2),
                    *_steps(steps),
                    f"Entonces {m.group(3)} = {_n(value)}",
                ]
    if "perímetro" in text or "área" in text:
        return _explain_geometry(text)
    least = r"¿Cuál es el menor número que puede ir en el \? para que sea verdad:"
    if m := re.fullmatch(rf"{least} \? \+ (\d+) > (\d+)\?", text):
        a, b = int(m.group(1)), int(m.group(2))
        x = b - a + 1
        return [
            f"Busca el número que da justo {b}: {b} - {a} = {b - a}",
            f"Necesitamos que sea MAYOR que {b}, así que sumamos 1: {x}.",
            f"Comprueba: {x} + {a} = {x + a}, que es mayor que {b}.",
            f"La respuesta es {x}.",
        ]
    if m := re.fullmatch(
        r"Una máquina cambia números con la misma regla: (.+)\. Si entra (\d+), ¿qué sale\?", text
    ):
        pairs = [(int(a), int(b)) for a, b in re.findall(r"entra (\d+), sale (\d+)", m.group(1))]
        new = int(m.group(2))
        first = f"Mira qué le pasa a cada número: {pairs[0][0]} pasa a {pairs[0][1]}."
        same = "Con los otros pasa lo mismo."
        adds = {b - a for a, b in pairs}
        if len(adds) == 1:
            k = adds.pop()
            return [
                first,
                f"La regla es sumar {k}.",
                same,
                f"{new} + {k} = {new + k}",
                f"Sale {new + k}.",
            ]
        muls = {b // a for a, b in pairs if a and b % a == 0}
        if len(muls) == 1:
            k = muls.pop()
            return [
                first,
                f"La regla es multiplicar por {k}.",
                same,
                f"{new} × {k} = {new * k}",
                f"Sale {new * k}.",
            ]
        return None
    if m := re.fullmatch(r"En una biblioteca hay (\d+) libros y llegan (\d+) más\. .*", text):
        a, b = int(m.group(1)), int(m.group(2))
        return [
            "Si llegan libros, hay más: se suma.",
            *_explain_sum(a, b)[:-1],
            f"Ahora hay {_n(a + b)} libros.",
        ]
    if m := re.fullmatch(
        r"En una biblioteca hay (\d+) libros\. Llegan (\d+) y se prestan (\d+)\. .*", text
    ):
        a, b, c = (int(g) for g in m.groups())
        return [
            "Hazlo en dos pasos: suma los que llegan y resta los que se prestan.",
            *_steps(
                [
                    f"{_n(a)} + {_n(b)} = {_n(a + b)}",
                    f"{_n(a + b)} - {_n(c)} = {_n(a + b - c)}",
                ]
            ),
            f"Quedan {_n(a + b - c)} libros.",
        ]
    return _explain_measure(text)


def _explain_geometry(text: str) -> Lines | None:
    # "cm²" puede llegar como "cm2" (el filtro de entrada normaliza el texto).
    text = re.sub(r"\b(c?m)[²2]", lambda m: m.group(1), text)
    nums = [int(x) for x in re.findall(r"\d+", text)]
    unit = "m" if re.search(r"\d+ m\b", text) else "cm"
    square = "cuadrado" in text
    if "perímetro" in text:
        intro = "El perímetro es lo que mide todo el borde de la figura."
        if "tiene un perímetro de" in text and square:
            p = nums[0]
            return [
                intro,
                "El cuadrado tiene 4 lados iguales.",
                f"Reparte {p} en 4: {p} ÷ 4 = {p // 4}",
                f"Cada lado mide {p // 4} {unit}.",
            ]
        if "tiene un perímetro de" in text:
            p, long = nums[0], nums[1]
            rest = p - 2 * long
            return [
                intro,
                "El rectángulo tiene 2 lados largos y 2 anchos.",
                *_steps(
                    [
                        f"{long} + {long} = {2 * long}, son los dos largos",
                        f"{p} - {2 * long} = {rest}, es lo que queda para los dos anchos",
                        f"{rest} ÷ 2 = {rest // 2}, es un ancho",
                    ]
                ),
                f"Mide {rest // 2} {unit} de ancho.",
            ]
        if square:
            s = nums[0]
            return [
                intro,
                "El cuadrado tiene 4 lados iguales.",
                f"{s} + {s} + {s} + {s} = {4 * s}",
                f"El perímetro es {4 * s} {unit}.",
            ]
        a, b = nums[0], nums[1]
        p = 2 * (a + b)
        return [
            intro,
            "Suma los 4 lados del rectángulo.",
            f"{a} + {b} + {a} + {b} = {p}",
            f"El perímetro es {p} {unit}.",
        ]
    intro = ["El área es cuántos cuadraditos caben dentro.", "Se multiplica el largo por el ancho."]
    if "tiene un área de" in text:
        s, a = nums[0], nums[1]
        return [
            *intro,
            "Aquí sabemos el área y un lado.",
            f"Piensa: ¿{a} por cuánto da {s}?",
            f"{s} ÷ {a} = {s // a}",
            f"El otro lado mide {s // a} {unit}.",
        ]
    if square:
        s = nums[0]
        return [
            *intro,
            "En el cuadrado los lados son iguales.",
            f"{s} × {s} = {s * s}",
            f"El área es {s * s} {unit}².",
        ]
    a, b = nums[0], nums[1]
    return [*intro, f"{a} × {b} = {a * b}", f"El área es {a * b} {unit}²."]


# (grande, chica, cuántas chicas hay en una grande)
_UNITS: tuple[tuple[tuple[str, ...], tuple[str, ...], int], ...] = (
    (("hora", "horas"), ("minuto", "minutos"), 60),
    (("minuto", "minutos"), ("segundo", "segundos"), 60),
    (("semana", "semanas"), ("día", "días"), 7),
    (("año", "años"), ("mes", "meses"), 12),
    (("m",), ("cm",), 100),
    (("kg",), ("g",), 1000),
)


def _unit_pair(src: str, dst: str) -> tuple[str, str, int, bool] | None:
    """(grande, chica, factor, ¿src es la grande?)."""
    for big, small, factor in _UNITS:
        if src in big and dst in small:
            return big[-1], small[-1], factor, True
        if src in small and dst in big:
            return big[-1], small[-1], factor, False
    return None


def _explain_measure(text: str) -> Lines | None:
    if m := re.fullmatch(r"(\d+) (\w+) = \? (\w+)", text):
        n, src, dst = int(m.group(1)), m.group(2), m.group(3)
        pair = _unit_pair(src, dst)
        if pair is None:
            return None
        big, small, factor, src_big = pair
        one_big = {
            "horas": "1 hora",
            "minutos": "1 minuto",
            "semanas": "1 semana",
            "años": "1 año",
        }.get(big, f"1 {big}")
        f = _n(factor)
        if src_big:
            return [
                f"{one_big} tiene {f} {small}.",
                f"Para pasar de {big} a {small} se multiplica:",
                f"{_n(n)} × {f} = {_n(n * factor)}",
                f"Son {_n(n * factor)} {dst}.",
            ]
        return [
            f"Cada {f} {small} forman {one_big}.",
            f"Para pasar de {small} a {big} se divide:",
            f"{_n(n)} ÷ {f} = {_n(n // factor)}",
            f"Son {_n(n // factor)} {dst}.",
        ]
    if text == "¿Cuántos gramos hay en 1 kg?":
        return ["Kilo quiere decir mil.", "1 kilo tiene 1.000 gramos.", "La respuesta es 1.000."]
    if text == "¿Cuántos gramos son medio kilo?":
        return [
            "1 kilo tiene 1.000 gramos.",
            "Medio kilo es la mitad: 1.000 ÷ 2 = 500",
            "La respuesta es 500.",
        ]
    if text == "¿Cuántos medios kilos se necesitan para formar 1 kg?":
        return [
            "Medio kilo es la mitad de 1 kilo.",
            "Dos mitades forman un entero: 500 + 500 = 1.000 gramos",
            "Se necesitan 2.",
        ]
    if m := re.fullmatch(r"Tienes (\d+) g\. ¿Cuántos gramos faltan para completar 1 kg\?", text):
        return ["1 kilo tiene 1.000 gramos.", *_missing_to_reach(int(m.group(1)), 1000)]
    if m := re.fullmatch(r"Un paseo dura (\d+) horas? y (\d+) minutos\. .*", text):
        h, mins = int(m.group(1)), int(m.group(2))
        hours = "1 hora son" if h == 1 else f"{h} horas son"
        return [
            "1 hora tiene 60 minutos.",
            "Pasa las horas a minutos y después suma los minutos que sobran.",
            *_steps(
                [
                    f"{hours} {h} × 60 = {60 * h} minutos",
                    f"{60 * h} + {mins} = {60 * h + mins}",
                ]
            ),
            f"Dura {60 * h + mins} minutos.",
        ]
    big_m = re.search(r"(\d+) (kg|m)\b", text)
    small_m = re.search(r"(\d+) (g|cm)\b", text)
    if big_m and small_m:
        k, big = int(big_m.group(1)), big_m.group(2)
        s, small = int(small_m.group(1)), small_m.group(2)
        factor = 1000 if big == "kg" else 100
        whole = k * factor
        to_small = f"{k} {big} son {k} × {_n(factor)} = {_n(whole)} {small}"
        if "juntas" in text or "juntos" in text:
            return [
                f"Pasa todo a {small} y después suma.",
                *_steps([to_small, f"{_n(whole)} + {s} = {_n(whole + s)}"]),
                f"Son {_n(whole + s)} {small}.",
            ]
        return [
            f"Pasa todo a {small} y después resta.",
            *_steps([to_small, f"{_n(whole)} - {s} = {_n(whole - s)}"]),
            f"Quedan {_n(whole - s)} {small}.",
        ]
    return None


def _explain(prompt: MathPrompt) -> str:
    """La explicación en líneas (una por paso), unidas con salto de línea."""
    text = _normalize(prompt.exercise)
    # Cadena de hechos ("10 + 2 = 12; …; 12 - ? = 10"): se explica la última.
    chain = text.split("; ")
    equation = chain[-1]
    eq = re.fullmatch(r"([\d ?+\-×x*÷/=]+?)(?:\. ¿.*)?", equation)

    from_equation = _explain_equation(eq.group(1).strip()) if eq else None
    if from_equation and len(chain) > 1:
        from_equation = [
            "Mira la familia de números.",
            "Todas esas cuentas usan los mismos 3 números.",
            *from_equation,
        ]
    lines = (
        _explain_fraction(text)
        or _explain_family(text)
        or from_equation
        or _explain_sequence(text)
        or _explain_words(text)
    )
    if lines is None:
        match = _OPERATION.search(text)
        if match:
            a, op, b = (
                int(match.group(1)),
                _OPS.get(match.group(2), match.group(2)),
                int(match.group(3)),
            )
            lines = _SIMPLE[op](a, b)
    if lines is not None:
        return "\n".join([*lines, _END])

    topic = get_topic(prompt.grade, prompt.topic)
    label = topic.label.lower() if topic else "matemáticas"
    return "\n".join(
        [
            f"Vamos a practicar {label}.",
            "Mira el ejercicio con calma.",
            "Primero, encuentra los números que aparecen.",
            "Luego piensa qué operación necesitas.",
            _END,
        ]
    )


def is_generic(text: str) -> bool:
    """¿Es la guía genérica (el simulado no reconoció el ejercicio)? Para pruebas."""
    return text.startswith("Vamos a practicar")


class MockProvider:
    def __init__(self, script: Sequence[str] | None = None, chunk_delay: float = 0.0) -> None:
        """`script`: fragmentos exactos (pruebas). `chunk_delay`: segundos entre fragmentos."""
        self._script = list(script) if script is not None else None
        self._delay = chunk_delay

    async def stream(self, prompt: MathPrompt) -> AsyncIterator[str]:
        if self._script is not None:
            chunks = self._script
        else:
            # Se corta por palabras; los saltos de línea viajan dentro de los fragmentos.
            words = _explain(prompt).split(" ")
            chunks = [
                " ".join(words[i : i + _WORDS_PER_CHUNK]) + " "
                for i in range(0, len(words), _WORDS_PER_CHUNK)
            ]
        for chunk in chunks:
            if self._delay:
                await asyncio.sleep(self._delay)
            yield chunk
