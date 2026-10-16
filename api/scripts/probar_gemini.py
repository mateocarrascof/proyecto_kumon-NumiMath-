"""Prueba REAL de Gemini con UNA pregunta corta, sin datos personales.

    api/.venv/Scripts/python api/scripts/probar_gemini.py

Usa GEMINI_API_KEY y GEMINI_MODEL de la configuración del servidor. Hace UNA sola llamada, con un
ejercicio fijo ("¿Cuánto es 7 + 5?", 1° básico) que pasa por los mismos filtros que en la app.
Imprime el nombre del modelo, la respuesta y un código de error si lo hay. NUNCA imprime la clave.

PROTOTIPO OPERADO POR ADULTOS: ver docs/privacy/pendientes-legales.md, 9.1.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from app.ai.factory import build_provider  # noqa: E402
from app.ai.gemini_provider import GeminiError  # noqa: E402
from app.ai.prompt import build_prompt  # noqa: E402
from app.config import Settings  # noqa: E402
from app.safety.input_filter import check_input  # noqa: E402
from app.safety.output_filter import OutputGuard  # noqa: E402

QUESTION = "¿Cuánto es 7 + 5?"  # fija, corta y sin datos personales


async def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        settings = Settings(ai_provider="gemini")
    except ValidationError as exc:
        # Solo los mensajes (nombres de variables), nunca los valores de entrada.
        for error in exc.errors():
            print("Configuración incompleta:", error["msg"])
        return 2

    provider = build_provider(settings)
    prompt = build_prompt(1, "sumas_hasta_20", check_input(QUESTION))
    print(f"Modelo: {settings.gemini_model}")
    print(f"Pregunta: {QUESTION}")
    guard = OutputGuard()
    delivered: list[str] = []
    try:
        async for chunk in provider.stream(prompt):
            sentences, violation = guard.feed(chunk)
            delivered.extend(sentences)
            if violation is not None:
                print(f"[el filtro de salida cortó la respuesta: {violation.reason}]")
                break
        else:
            sentences, violation = guard.flush()
            delivered.extend(sentences)
            if violation is not None:
                print(f"[el filtro de salida cortó el final: {violation.reason}]")
    except GeminiError as exc:
        print(f"Error del proveedor: {exc.code}")
        return 1
    finally:
        aclose = getattr(provider, "aclose", None)
        if aclose is not None:
            await aclose()
    print("Respuesta:", " ".join(delivered) if delivered else "(vacía)")
    return 0 if delivered else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
