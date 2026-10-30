"""Filtro de SALIDA: valida lo que la IA genera ANTES de que llegue al niño (CLAUDE.md, ADR 0001).

Funciona por ORACIONES: acumula el texto hasta completar una oración y solo entonces la valida y
la entrega. Así nada inseguro se envía "a medias" y un enlace o un dato cortado entre dos
fragmentos igualmente se detecta.

Reglas (solo matemáticas, apto para 6 a 10 años, sin pedir datos):
  - sin enlaces, correos, teléfonos ni RUT;
  - sin pedirle al niño datos personales ni pedirle guardar secretos;
  - sin groserías ni temas de adultos, ni conversar sobre angustia o daño (eso es para un adulto);
  - sin HTML, imágenes, enlaces con formato ni bloques de código;
  - sin revelar las instrucciones;
  - oraciones y respuesta de largo acotado (lenguaje simple).

Ante la primera infracción el guardia se CIERRA: no entrega esa oración ni nada posterior.
El filtro no contiene texto del niño ni de la IA en sus resultados: solo el código del motivo.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Final

from app.safety import normalize
from app.safety.input_filter import has_profanity, has_unsafe_topic
from app.safety.patterns import (
    ASKS_PERSONAL_DATA,
    PII_NUMERIC,
    SUPPORT_PATTERNS,
    UNSAFE_OUTPUT_FORMAT,
)

MAX_SENTENCE_CHARS: Final = 280
MAX_WORDS_PER_SENTENCE: Final = 40
MAX_TOTAL_CHARS: Final = 1200

NEUTRAL_MESSAGE: Final = "Ups, no puedo seguir con esta explicación. ¡Probemos con otro ejercicio!"

# Un punto entre dígitos (3.5, 1.000) no termina la oración.
_TERMINATOR = re.compile(r"[.!?…]+(?=\s)|\n")

_LINKS: tuple[re.Pattern[str], ...] = (
    *PII_NUMERIC,
    re.compile(r"\bwww\b"),
    re.compile(r"https?\b"),
    re.compile(r"\b[a-z0-9-]+\s*punto\s*(com|cl|net|org)\b"),
    re.compile(r"\barroba\b"),
)

_LEAK: tuple[re.Pattern[str], ...] = (
    # Razonamiento interno del modelo que se cuela como texto (no es para el niño).
    re.compile(r"\b(constraints?|the user|user input|system instruction|let me|i should)\b"),
    re.compile(r"\bsystem prompt\b"),
    re.compile(r"\binstrucciones (del sistema|internas|anteriores)\b"),
    re.compile(r"\bmis instrucciones\b"),
)


# Angustia o daño dicho en otras personas gramaticales ("uno se quiere morir").
_SENSITIVE_OUTPUT: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"\b(se|te) quiere(s|n)? (morir|matar)",
        r"\bquieres? (morir|matarte|hacerte dano)\b",
        r"\b(hacerte|hacerse|lastimarte|lastimarse) dano\b",
        r"\b(hacerte|hacerse) dano\b",
    )
)


_BOLD = re.compile(r"(\*\*|__)")
_EMPHASIS = re.compile(r"(?<![\w*])\*(\S(?:[^*]*?\S)?)\*(?![\w*])")
_BULLET = re.compile(r"^\s*(?:[*•-]|#{1,6})\s+")


def strip_markdown(sentence: str) -> str:
    """Quita el formato Markdown (negritas, énfasis, viñetas, títulos): la app muestra texto plano.

    Se conservan los signos matemáticos: "3 * 4" y "5 - 2" no cambian.
    """
    text = _BOLD.sub("", sentence)
    text = _EMPHASIS.sub(r"\1", text)
    text = _BULLET.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass(frozen=True)
class Violation:
    reason: str


def check_sentence(sentence: str) -> Violation | None:
    """Devuelve la infracción de una oración completa, o `None` si es segura."""
    plain = normalize.strip_accents(normalize.clean(sentence).casefold())
    matching = normalize.to_matching_text(sentence)
    words = normalize.words(sentence)

    if len(sentence) > MAX_SENTENCE_CHARS or len(words) > MAX_WORDS_PER_SENTENCE:
        return Violation("too_complex")
    if any(p.search(plain) or p.search(matching) for p in _LINKS):
        return Violation("link_or_contact")
    if any(p.search(plain) or p.search(matching) for p in ASKS_PERSONAL_DATA):
        return Violation("asks_personal_data")
    if any(p.search(plain) or p.search(matching) for p in UNSAFE_OUTPUT_FORMAT):
        return Violation("unsafe_format")
    if has_profanity(words):
        return Violation("profanity")
    if has_unsafe_topic(words, matching):
        return Violation("unsafe_topic")
    if any(p.search(matching) for p in _LEAK):
        return Violation("prompt_leak")
    if any(p.search(matching) for p in (*SUPPORT_PATTERNS, *_SENSITIVE_OUTPUT)):
        # La IA no debe dramatizar ni conversar sobre angustia o daño: eso es para un adulto.
        return Violation("sensitive_topic")
    return None


@dataclass
class OutputGuard:
    """Una instancia por respuesta. `feed` con cada fragmento y `flush` al terminar."""

    _buffer: str = ""
    _emitted_chars: int = 0
    _closed: bool = False
    violation: Violation | None = field(default=None)

    @property
    def closed(self) -> bool:
        return self._closed

    def _close(self, reason: str) -> Violation:
        self._closed = True
        self.violation = Violation(reason)
        self._buffer = ""
        return self.violation

    def _emit(self, sentences: list[str], sentence: str, newline: bool = False) -> Violation | None:
        problem = check_sentence(sentence)
        if problem is not None:
            return self._close(problem.reason)
        # El salto cuenta como un carácter más: muchas líneas cortas no pueden alargar la burbuja
        # más allá del tope total.
        size = len(sentence) + (1 if newline else 0)
        if self._emitted_chars + size > MAX_TOTAL_CHARS:
            return self._close("output_too_long")
        self._emitted_chars += size
        cleaned = strip_markdown(sentence)
        if cleaned:
            # El salto final indica a la app que la línea termina aquí.
            sentences.append(cleaned + "\n" if newline else cleaned)
        return None

    def feed(self, chunk: str) -> tuple[list[str], Violation | None]:
        """Devuelve (oraciones seguras listas para enviar, infracción si la hubo)."""
        if self._closed:
            return [], self.violation
        self._buffer += chunk
        sentences: list[str] = []

        while True:
            match = _TERMINATOR.search(self._buffer)
            if match is None:
                break
            end = match.end()
            sentence = self._buffer[:end].strip()
            rest = self._buffer[end:]
            spacing = rest[: len(rest) - len(rest.lstrip())]
            # ¿La oración cierra una línea? Se conserva el salto (un paso por línea en la burbuja).
            # Solo cambia la presentación: la oración se valida igual, sin el salto.
            newline = "\n" in match.group() or "\n" in spacing
            if not newline and not rest.strip():
                # Tras ". " todavía no se sabe si viene un salto en el próximo fragmento: la entrega
                # espera (si no llega nada más, `flush` la entrega), pero se valida YA, para cortar
                # en el mismo momento que antes si es insegura.
                problem = check_sentence(sentence) if sentence else None
                if problem is not None:
                    return sentences, self._close(problem.reason)
                break
            self._buffer = rest.lstrip()
            if not sentence:
                continue
            violation = self._emit(sentences, sentence, newline)
            if violation is not None:
                return sentences, violation

        # Texto acumulado sin cerrar la oración: no puede crecer sin límite.
        if len(self._buffer) > MAX_SENTENCE_CHARS:
            return sentences, self._close("too_complex")
        return sentences, None

    def flush(self) -> tuple[list[str], Violation | None]:
        """Valida y entrega lo que quede al terminar la respuesta."""
        if self._closed:
            return [], self.violation
        remainder, self._buffer = self._buffer.strip(), ""
        if not remainder:
            return [], None
        sentences: list[str] = []
        violation = self._emit(sentences, remainder)
        return sentences, violation
