"""Elige el proveedor de IA según `AI_PROVIDER`.

Para añadir uno real: escribir una clase que cumpla `AIProvider`, agregarla aquí y a los valores
permitidos de `ai_provider` en `config.py`. Su clave va en una variable de entorno del servidor.
"""

from __future__ import annotations

from app.ai.gemini_provider import GeminiProvider
from app.ai.mock_provider import MockProvider
from app.ai.provider import AIProvider
from app.config import Settings


def build_provider(settings: Settings) -> AIProvider:
    if settings.ai_provider == "mock":
        return MockProvider()
    if settings.ai_provider == "gemini":
        # `Settings` ya garantizó clave y modelo (sin alias "-latest").
        return GeminiProvider(
            settings.gemini_api_key.get_secret_value(),
            settings.gemini_model.strip(),
            max_output_tokens=settings.gemini_max_output_tokens,
            thinking_level=settings.gemini_thinking_level,
            first_chunk_seconds=settings.gemini_first_chunk_seconds,
        )
    raise ValueError("proveedor de IA no soportado")  # pragma: no cover
