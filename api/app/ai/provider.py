"""Interfaz del proveedor de IA.

Hoy existe un proveedor simulado (`mock_provider.py`). Para usar uno real basta con escribir otra
clase que cumpla `AIProvider` y elegirla con `AI_PROVIDER`; nada más del servidor cambia.

Lo único que un proveedor recibe es un `MathPrompt`: curso, tema y ejercicio ya filtrado.
NUNCA recibe apodo, identificadores del niño o del tutor, ni datos de dispositivo.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class MathPrompt:
    grade: int  # 1 a 4, leído de la base
    topic: str  # id de un tema de `topics.py`
    exercise: str  # texto del niño ya aprobado por el filtro de entrada


class AIProvider(Protocol):
    def stream(self, prompt: MathPrompt) -> AsyncIterator[str]:
        """Devuelve la explicación como fragmentos de texto, en orden.

        El texto NO es de confianza: el servidor lo pasa por el filtro de salida antes de
        enviarlo al niño.
        """
        ...
