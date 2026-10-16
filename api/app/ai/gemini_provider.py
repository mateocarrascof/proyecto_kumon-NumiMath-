"""Proveedor de IA real: API REST de Gemini (`streamGenerateContent`, SSE), sin SDK.

PROTOTIPO OPERADO POR ADULTOS: los términos de la API de Gemini exigen 18+ y prohíben apps
dirigidas a menores (ver `docs/privacy/pendientes-legales.md`, 9.1). No usar con niños reales.

Reglas de este módulo:
- La clave viaja SOLO en la cabecera `x-goog-api-key` (nunca en la URL, para que no quede en
  registros de proxies) y no aparece en ningún mensaje de error ni log.
- Las reglas van en `systemInstruction` y el ejercicio del niño, solo, en `contents`.
- El modelo es el configurado en `GEMINI_MODEL`: un nombre de versión estable, elegido por la
  persona responsable. No hay valor por defecto ni alias "-latest".
- Los errores solo llevan un código ("http_429", "timeout_first_chunk"…): nunca el cuerpo de la
  respuesta, la URL ni texto del niño o del modelo.
- El texto del modelo NO es de confianza: sigue pasando por el filtro de salida.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any, Final

import httpx

from app.ai.prompt import render_system_instruction, render_user_message
from app.ai.provider import MathPrompt

BASE_URL: Final = "https://generativelanguage.googleapis.com/v1beta"

_BLOCKING_FINISH = frozenset({"SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"})
_SAFETY_CATEGORIES = (
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
)


class GeminiError(Exception):
    """Fallo del proveedor. `code` es un código estable apto para logs (sin datos)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def build_request_body(
    prompt: MathPrompt, max_output_tokens: int, thinking_level: str = ""
) -> dict[str, Any]:
    """Cuerpo de la petición. Es lo ÚNICO que sale hacia Gemini: curso, tema y ejercicio."""
    generation: dict[str, Any] = {"maxOutputTokens": max_output_tokens, "temperature": 0.3}
    if thinking_level:
        generation["thinkingConfig"] = {"thinkingLevel": thinking_level}
    return {
        "systemInstruction": {"parts": [{"text": render_system_instruction(prompt)}]},
        "contents": [{"role": "user", "parts": [{"text": render_user_message(prompt)}]}],
        "generationConfig": generation,
        "safetySettings": [
            {"category": category, "threshold": "BLOCK_MEDIUM_AND_ABOVE"}
            for category in _SAFETY_CATEGORIES
        ],
    }


def parse_event(data: str) -> tuple[list[str], bool]:
    """Texto de un evento SSE y si el modelo cortó por seguridad. Lanza `GeminiError` si el
    mensaje fue bloqueado desde el inicio."""
    try:
        payload = json.loads(data)
    except ValueError:
        raise GeminiError("bad_event") from None
    if not isinstance(payload, dict):
        raise GeminiError("bad_event")
    feedback = payload.get("promptFeedback")
    if isinstance(feedback, dict) and feedback.get("blockReason") not in (
        None,
        "BLOCK_REASON_UNSPECIFIED",
    ):
        raise GeminiError("prompt_blocked")
    texts: list[str] = []
    blocked = False
    for candidate in payload.get("candidates") or []:
        if not isinstance(candidate, dict):
            continue
        if candidate.get("finishReason") in _BLOCKING_FINISH:
            blocked = True
        content = candidate.get("content")
        parts = content.get("parts") if isinstance(content, dict) else None
        for part in parts or []:
            if isinstance(part, dict) and not part.get("thought"):
                text = part.get("text")
                if isinstance(text, str) and text:
                    texts.append(text)
    return texts, blocked


class GeminiProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        max_output_tokens: int = 1024,
        thinking_level: str = "low",
        first_chunk_seconds: float = 12.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._url = f"{BASE_URL}/models/{model}:streamGenerateContent"
        self._max_tokens = max_output_tokens
        self._thinking_level = thinking_level
        self._first_chunk_seconds = first_chunk_seconds
        # Se crea al primer uso. Lectura: 15 s entre fragmentos; el plazo total lo pone el servidor.
        self._client = client

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=3.0, read=15.0, write=5.0, pool=3.0)
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def stream(self, prompt: MathPrompt) -> AsyncIterator[str]:
        body = build_request_body(prompt, self._max_tokens, self._thinking_level)
        headers = {"x-goog-api-key": self._api_key, "Content-Type": "application/json"}
        try:
            async with self._get_client().stream(
                "POST", self._url, params={"alt": "sse"}, json=body, headers=headers
            ) as response:
                if response.status_code != 200:
                    # No se lee el cuerpo: puede repetir datos de la petición.
                    raise GeminiError(f"http_{response.status_code}")
                lines = response.aiter_lines().__aiter__()
                first = True
                while True:
                    try:
                        if first:
                            async with asyncio.timeout(self._first_chunk_seconds):
                                line = await lines.__anext__()
                        else:
                            line = await lines.__anext__()
                    except StopAsyncIteration:
                        return
                    except TimeoutError:
                        raise GeminiError("timeout_first_chunk") from None
                    if not line.startswith("data:"):
                        continue
                    texts, blocked = parse_event(line.removeprefix("data:").strip())
                    for text in texts:
                        first = False
                        yield text
                    if blocked:
                        raise GeminiError("response_blocked")
        except httpx.TimeoutException:
            raise GeminiError("timeout") from None
        except httpx.HTTPError:
            # El texto de la excepción puede incluir la URL: no se conserva.
            raise GeminiError("transport") from None
