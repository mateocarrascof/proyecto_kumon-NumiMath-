"""Filtro de ENTRADA: el texto libre que escribe el niño, antes de llegar a la IA (ADR 0001, 5).

Orden de las comprobaciones (la primera que falla decide el motivo):
  vacío → demasiado largo → datos personales → groserías → temas inapropiados →
  intento de manipular al modelo → fuera de tema.

Es un filtro por reglas (ver `patterns.py`): determinista y verificable, con falsos positivos y
negativos conocidos. El texto original no se modifica ni se devuelve en el rechazo.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final, Literal

from app.safety import normalize
from app.safety.patterns import (
    MATH_KEYWORD_STEMS,
    MATH_SYMBOLS,
    OFF_TOPIC_TERMS,
    PII_NUMERIC,
    PII_TEXT,
    PROFANITY_EXACT_ONLY,
    PROFANITY_STEMS,
    PROFANITY_SUBSTRINGS,
    PROMPT_INJECTION,
    SUPPORT_PATTERNS,
    UNSAFE_TOPIC_EXACT_ONLY,
    UNSAFE_TOPIC_PHRASES,
    UNSAFE_TOPIC_STEMS,
)

MAX_INPUT_CHARS: Final = 200

# Los términos fuera de tema se buscan al INICIO de una palabra ("chistes" sí, "medios" o
# "descuento" no): como subcadena rechazaban enunciados normales ("medios kilos" contiene "dios").
_OFF_TOPIC: Final = re.compile(r"\b(?:" + "|".join(re.escape(t) for t in OFF_TOPIC_TERMS) + ")")

Reason = Literal[
    "empty",
    "too_long",
    "needs_support",
    "pii",
    "profanity",
    "unsafe_topic",
    "prompt_injection",
    "off_topic",
]

# ╔══════════════════════════════════════════════════════════════════════════════════════════╗
# ║  PENDIENTE DE VALIDACIÓN PROFESIONAL (psicología infantil / protección de la niñez).     ║
# ║  Este mensaje es PROVISIONAL: lo escribió el asistente. No usar con niños reales sin     ║
# ║  que lo revise una persona con la formación adecuada. No incluye teléfonos a propósito:  ║
# ║  los números de ayuda deben verificarse y definirse con esa persona.                     ║
# ╚══════════════════════════════════════════════════════════════════════════════════════════╝
SUPPORT_MESSAGE: Final = (
    "Gracias por contármelo. Lo que sientes importa. "
    "Habla ahora con un adulto de confianza, como tu mamá, tu papá, tu profe o alguien de tu "
    "familia. Si estás en peligro, avísale a un adulto de inmediato. "
    "Cuando quieras, seguimos con matemáticas."
)

# Mensajes para el niño: amables, cortos, sin repetir lo que escribió y sin explicar el filtro.
CHILD_MESSAGES: Final[dict[Reason, str]] = {
    "empty": "Escribe tu pregunta de matemáticas y te ayudo.",
    "too_long": "¡Qué mensaje tan largo! Cuéntamelo más cortito, por favor.",
    "needs_support": SUPPORT_MESSAGE,
    "pii": "Por tu seguridad, no escribas datos personales. Pregúntame solo de matemáticas.",
    "profanity": "Hablemos con palabras amables. Pregúntame algo de matemáticas.",
    "unsafe_topic": "De eso no puedo hablar. Pregúntame algo de matemáticas.",
    "prompt_injection": "Solo puedo ayudarte con matemáticas. ¿Qué ejercicio quieres practicar?",
    "off_topic": "Yo te ayudo con matemáticas. ¿Qué ejercicio quieres practicar?",
}


@dataclass(frozen=True)
class InputCheck:
    allowed: bool
    reason: Reason | None = None
    text: str = ""  # texto limpio (espacios colapsados, sin invisibles); solo si `allowed`


def matches_stem(
    word: str, stems: tuple[str, ...], exact_only: frozenset[str] = frozenset()
) -> bool:
    for stem in stems:
        if word == stem:
            return True
        if stem not in exact_only and len(stem) >= 4 and word.startswith(stem):
            return True
    return False


def has_profanity(words: list[str]) -> bool:
    """Prefijos y palabras exactas, más fragmentos fuertes dentro de la palabra ("aweonao")."""
    for word in words:
        if matches_stem(word, PROFANITY_STEMS, PROFANITY_EXACT_ONLY):
            return True
        if len(word) >= 5 and any(fragment in word for fragment in PROFANITY_SUBSTRINGS):
            return True
    return False


def has_unsafe_topic(words: list[str], matching: str) -> bool:
    if any(matches_stem(w, UNSAFE_TOPIC_STEMS, UNSAFE_TOPIC_EXACT_ONLY) for w in words):
        return True
    return any(p.search(matching) for p in UNSAFE_TOPIC_PHRASES)


def _has_math_signal(cleaned: str, matching: str, words: list[str]) -> bool:
    if MATH_SYMBOLS.search(cleaned):
        return True
    for stem in MATH_KEYWORD_STEMS:
        if " " in stem:
            if stem in matching:
                return True
            continue
        for word in words:
            if word == stem or (len(stem) >= 5 and word.startswith(stem)):
                return True
    return False


def check_input(text: str) -> InputCheck:
    cleaned = normalize.clean(text)
    if not cleaned:
        return InputCheck(False, "empty")
    if len(cleaned) > MAX_INPUT_CHARS:
        return InputCheck(False, "too_long")

    lowered = cleaned.casefold()
    matching = normalize.to_matching_text(cleaned)
    plain = normalize.strip_accents(lowered)  # sin "leet": se usa para patrones y números
    words = normalize.words(cleaned)

    # Primero el camino de apoyo: un niño que pide ayuda no debe recibir un "no puedo hablar de eso"
    # ni un rechazo por datos personales. El texto nunca llega a la IA.
    if any(p.search(matching) for p in SUPPORT_PATTERNS):
        return InputCheck(False, "needs_support")

    # Los patrones con dígitos usan `plain`; el resto también se prueba sobre el texto "leet".
    if any(p.search(plain) for p in PII_NUMERIC) or any(
        p.search(plain) or p.search(matching) for p in PII_TEXT
    ):
        return InputCheck(False, "pii")

    if has_profanity(words):
        return InputCheck(False, "profanity")

    if has_unsafe_topic(words, matching):
        return InputCheck(False, "unsafe_topic")

    if any(p.search(matching) for p in PROMPT_INJECTION):
        return InputCheck(False, "prompt_injection")

    if _OFF_TOPIC.search(matching):
        return InputCheck(False, "off_topic")

    if not _has_math_signal(cleaned, matching, words):
        return InputCheck(False, "off_topic")

    return InputCheck(True, None, cleaned)


def check_tutor_text(text: str) -> InputCheck:
    """Filtro para el enunciado que escribe el TUTOR en una tarea ("Tareas de tu tutor").

    Es texto de un adulto que el niño va a leer y que nunca se envía a la IA. Por eso solo se
    revisa lo que importa ahí: largo, datos personales, groserías y temas inapropiados.
    No se aplican las reglas pensadas para la conversación con la IA (manipular al modelo,
    "fuera de tema" por palabras sueltas, señal matemática): rechazaban problemas normales,
    p. ej. "un descuento de 29" (contiene "cuento") o "Juan fue a jugar con 3 amigos".
    """
    cleaned = normalize.clean(text)
    if not cleaned:
        return InputCheck(False, "empty")
    if len(cleaned) > MAX_INPUT_CHARS:
        return InputCheck(False, "too_long")

    matching = normalize.to_matching_text(cleaned)
    plain = normalize.strip_accents(cleaned.casefold())
    words = normalize.words(cleaned)

    if any(p.search(plain) for p in PII_NUMERIC) or any(
        p.search(plain) or p.search(matching) for p in PII_TEXT
    ):
        return InputCheck(False, "pii")
    if has_profanity(words):
        return InputCheck(False, "profanity")
    if any(p.search(matching) for p in SUPPORT_PATTERNS) or has_unsafe_topic(words, matching):
        return InputCheck(False, "unsafe_topic")
    return InputCheck(True, None, cleaned)
