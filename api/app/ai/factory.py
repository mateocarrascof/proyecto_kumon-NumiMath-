"""Elige el proveedor de IA según `AI_PROVIDER`.

Para añadir uno real: escribir una clase que cumpla `AIProvider`, agregarla aquí y a los valores
permitidos de `ai_provider` en `config.py`. Su clave va en una variable de entorno del servidor.
"""

from __future__ import annotations

from app.ai.mock_provider import MockProvider
from app.ai.provider import AIProvider
from app.config import Settings


def build_provider(settings: Settings) -> AIProvider:
    if settings.ai_provider == "mock":
        return MockProvider()
    raise ValueError("proveedor de IA no soportado")  # pragma: no cover
