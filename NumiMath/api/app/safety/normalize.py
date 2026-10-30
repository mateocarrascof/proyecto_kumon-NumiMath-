"""Normalización del texto antes de aplicar los filtros.

Objetivo: que "P U T A", "m1erd4", "Pu-ta" o caracteres de ancho completo no esquiven las listas.
El texto original del niño NUNCA se modifica para el resto del sistema; esto es solo para comparar.
"""

from __future__ import annotations

import re
import unicodedata

_LEET = str.maketrans(
    {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}
)
# Letras cirílicas y griegas que se ven igual que una latina ("рuta" con р cirílica). Se comparan
# ya en minúsculas. No pretende ser una tabla completa de confundibles: cubre las más usadas.
_CONFUSABLES = str.maketrans(
    {
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i",
        "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "к": "k", "м": "m", "т": "t", "н": "h",
        "α": "a", "ε": "e", "ι": "i", "ο": "o", "ρ": "p", "υ": "u", "ν": "v", "τ": "t",
        "κ": "k", "χ": "x", "μ": "u",
    }
)  # fmt: skip
_WORD = re.compile(r"[a-zñ]+")
_REPEATS = re.compile(r"(.)\1{2,}")


def clean(text: str) -> str:
    """NFKC, sin caracteres invisibles ni de control, espacios colapsados."""
    text = unicodedata.normalize("NFKC", text)
    text = "".join(
        ch for ch in text if unicodedata.category(ch) not in {"Cf", "Cc"} or ch in {" ", "\n", "\t"}
    )
    return re.sub(r"\s+", " ", text).strip()


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def to_matching_text(text: str) -> str:
    """Minúsculas, sin tildes y con las sustituciones tipo "leet" deshechas.

    `ñ` se conserva como `n` para que "weón" y "weon" coincidan.
    """
    base = strip_accents(clean(text).casefold()).translate(_CONFUSABLES)
    return base.translate(_LEET)


def words(text: str) -> list[str]:
    """Palabras del texto normalizado. Une letras sueltas ("p u t a" → "puta") y contrae
    repeticiones largas ("puuuta" → "puta")."""
    raw = _WORD.findall(_REPEATS.sub(r"\1", to_matching_text(text)))
    merged: list[str] = []
    run: list[str] = []
    for token in raw:
        if len(token) == 1:
            run.append(token)
            continue
        if run:
            merged.append("".join(run))
            run = []
        merged.append(token)
    if run:
        merged.append("".join(run))
    return merged
