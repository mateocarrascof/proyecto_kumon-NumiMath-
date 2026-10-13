"""Filtro de ENTRADA: el texto libre que escribe el niño, antes de llegar a la IA (ADR 0001, 5).

Orden de las comprobaciones (la primera que falla decide el motivo):
  vacío → demasiado largo → datos personales → groserías → temas inapropiados →
  intento de manipular al modelo → fuera de tema.

Es un filtro por reglas (ver `patterns.py`): determinista y verificable, con falsos positivos y
negativos conocidos. El texto original no se modifica ni se devuelve en el rechazo.
"""

from __future__ import annotations

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
    PROMPT_INJECTION,
    UNSAFE_TOPIC_EXACT_ONLY,
    UNSAFE_TOPIC_STEMS,
)

MAX_INPUT_CHARS: Final = 200

Reason = Literal[
    "empty", "too_long", "pii", "profanity", "unsafe_topic", "prompt_injection", "off_topic"
]

# Mensajes para el niño: amables, cortos, sin repetir lo que escribió y sin explicar el filtro.
CHILD_MESSAGES: Final[dict[Reason, str]] = {
    "empty": "Escribe tu pregunta de matemáticas y te ayudo.",
    "too_long": "¡Qué mensaje tan largo! Cuéntamelo más cortito, por favor.",
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


def _matches_stem(
    word: str, stems: tuple[str, ...], exact_only: frozenset[str] = frozenset()
) -> bool:
    for stem in stems:
        if word == stem:
            return True
        if stem not in exact_only and len(stem) >= 4 and word.startswith(stem):
            return True
    return False


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

    # Los patrones con dígitos usan `plain`; el resto también se prueba sobre el texto "leet".
    if any(p.search(plain) for p in PII_NUMERIC) or any(
        p.search(plain) or p.search(matching) for p in PII_TEXT
    ):
        return InputCheck(False, "pii")

    if any(_matches_stem(w, PROFANITY_STEMS, PROFANITY_EXACT_ONLY) for w in words):
        return InputCheck(False, "profanity")

    if any(_matches_stem(w, UNSAFE_TOPIC_STEMS, UNSAFE_TOPIC_EXACT_ONLY) for w in words):
        return InputCheck(False, "unsafe_topic")

    if any(p.search(matching) for p in PROMPT_INJECTION):
        return InputCheck(False, "prompt_injection")

    if any(term in matching for term in OFF_TOPIC_TERMS):
        return InputCheck(False, "off_topic")

    if not _has_math_signal(cleaned, matching, words):
        return InputCheck(False, "off_topic")

    return InputCheck(True, None, cleaned)
