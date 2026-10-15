"""Proveedor de IA SIMULADO: determinista, sin red y sin claves.

Sirve para desarrollar y probar todo el flujo (filtros, límites, streaming) sin un modelo real.
Resuelve operaciones simples y, si no reconoce una, responde con una guía genérica del tema.
Permite inyectar un guion (`script`) para probar cómo reacciona el servidor ante salidas
inseguras o lentas.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator, Sequence

from app.ai.provider import MathPrompt
from app.ai.topics import get_topic

_OPERATION = re.compile(r"(\d{1,6})\s*([+\-×x*÷/])\s*(\d{1,6})")
_WORDS_PER_CHUNK = 3


def _explain(prompt: MathPrompt) -> str:
    match = _OPERATION.search(prompt.exercise)
    if match:
        a, op, b = int(match.group(1)), match.group(2), int(match.group(3))
        if op == "+":
            return (
                f"¡Vamos a sumar {a} + {b}! Empieza con {a}. Ahora agrega {b}, de a poquito. "
                f"El resultado es {a + b}. ¡Muy bien! ¿Quieres practicar otra suma?"
            )
        if op == "-":
            if b <= a:
                return (
                    f"¡Vamos a restar {a} - {b}! Empieza con {a}. Quita {b}, de a poquito. "
                    f"El resultado es {a - b}. ¡Buen trabajo! ¿Probamos otra resta?"
                )
            return (
                f"Esta resta pide quitar {b} a {a}, y {b} es más grande. "
                "Revisa el ejercicio y cuéntame qué números tienes. ¡Lo vemos juntos!"
            )
        if op in ("×", "x", "*"):
            return (
                f"¡Vamos a multiplicar {a} × {b}! Significa juntar {b} grupos de {a}. "
                f"El resultado es {a * b}. ¡Excelente! ¿Quieres probar otra multiplicación?"
            )
        if b == 0:
            return "No se puede dividir en cero grupos. Revisa el ejercicio y lo vemos juntos."
        quotient, remainder = divmod(a, b)
        tail = f" y sobran {remainder}" if remainder else ""
        return (
            f"¡Vamos a dividir {a} ÷ {b}! Reparte {a} en {b} grupos iguales. "
            f"A cada grupo le tocan {quotient}{tail}. ¡Muy bien! ¿Probamos otra división?"
        )

    topic = get_topic(prompt.grade, prompt.topic)
    label = topic.label.lower() if topic else "matemáticas"
    return (
        f"¡Muy bien! Vamos a practicar {label}. Mira el ejercicio con calma. "
        "Primero, encuentra los números que aparecen. Luego piensa qué operación necesitas. "
        "Cuéntame el resultado que te da y lo revisamos juntos."
    )


class MockProvider:
    def __init__(self, script: Sequence[str] | None = None, chunk_delay: float = 0.0) -> None:
        """`script`: fragmentos exactos (pruebas). `chunk_delay`: segundos entre fragmentos."""
        self._script = list(script) if script is not None else None
        self._delay = chunk_delay

    async def stream(self, prompt: MathPrompt) -> AsyncIterator[str]:
        if self._script is not None:
            chunks = self._script
        else:
            words = _explain(prompt).split(" ")
            chunks = [
                " ".join(words[i : i + _WORDS_PER_CHUNK]) + " "
                for i in range(0, len(words), _WORDS_PER_CHUNK)
            ]
        for chunk in chunks:
            if self._delay:
                await asyncio.sleep(self._delay)
            yield chunk
