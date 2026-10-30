"""Proveedor Gemini sin red: forma de la petición, SSE y errores sin filtrar secretos."""

from __future__ import annotations

import asyncio
import io
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import respx

from app.ai.factory import build_provider
from app.ai.gemini_provider import BASE_URL, GeminiError, GeminiProvider, build_request_body
from app.ai.prompt import build_prompt
from app.ai.provider import MathPrompt
from app.config import Settings
from app.safety.input_filter import check_input

KEY = "clave-secreta-de-prueba-NO-REAL-0123456789"
MODEL = "modelo-estable-de-prueba-1"
URL = f"{BASE_URL}/models/{MODEL}:streamGenerateContent"


def _prompt(exercise: str = "¿Cuánto es 7 + 5?") -> MathPrompt:
    return build_prompt(1, "1-08", check_input(exercise))


def _sse(*events: dict[str, Any]) -> bytes:
    return "".join(f"data: {json.dumps(e)}\r\n\r\n" for e in events).encode()


def _text(text: str, finish: str | None = None) -> dict[str, Any]:
    candidate: dict[str, Any] = {"content": {"role": "model", "parts": [{"text": text}]}}
    if finish:
        candidate["finishReason"] = finish
    return {"candidates": [candidate]}


async def _collect(provider: GeminiProvider, prompt: MathPrompt) -> list[str]:
    return [chunk async for chunk in provider.stream(prompt)]


# ---- petición ----------------------------------------------------------------------------


@respx.mock
async def test_la_clave_va_en_la_cabecera_y_no_en_la_url() -> None:
    route = respx.post(URL).respond(200, content=_sse(_text("Hola. ")))
    await _collect(GeminiProvider(KEY, MODEL), _prompt())
    request = route.calls.last.request
    assert request.headers["x-goog-api-key"] == KEY
    assert KEY not in str(request.url)
    assert request.url.params["alt"] == "sse"


def test_las_reglas_van_en_systeminstruction_y_el_ejercicio_solo_en_contents() -> None:
    body = build_request_body(_prompt("¿Cuánto es 7 + 5?"), 300)
    system = body["systemInstruction"]["parts"][0]["text"]
    user = body["contents"][0]["parts"][0]["text"]
    assert "7 + 5" not in system
    assert user == "¿Cuánto es 7 + 5?"
    assert body["contents"][0]["role"] == "user" and len(body["contents"]) == 1
    assert body["generationConfig"]["maxOutputTokens"] == 300


def test_la_peticion_solo_lleva_curso_tema_y_ejercicio() -> None:
    body = json.dumps(build_request_body(_prompt(), 300), ensure_ascii=False)
    for forbidden in ("apodo", "nickname", "tutor_id", "student_id", "email", "uuid", KEY):
        assert forbidden not in body.lower()
    assert "1° básico" in body and "Sumas hasta 20" in body


def test_los_filtros_de_seguridad_de_gemini_estan_activos() -> None:
    settings = build_request_body(_prompt(), 300)["safetySettings"]
    assert {s["category"] for s in settings} >= {
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    }
    assert all(s["threshold"] == "BLOCK_MEDIUM_AND_ABOVE" for s in settings)


# ---- lectura del SSE ---------------------------------------------------------------------


@respx.mock
async def test_entrega_los_fragmentos_en_orden() -> None:
    respx.post(URL).respond(200, content=_sse(_text("¡Vamos a sumar! "), _text("Es 12.", "STOP")))
    assert await _collect(GeminiProvider(KEY, MODEL), _prompt()) == ["¡Vamos a sumar! ", "Es 12."]


@respx.mock
async def test_ignora_las_partes_de_razonamiento_interno() -> None:
    event = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "pensando…", "thought": True}, {"text": "Es 12. "}],
                }
            }
        ]
    }
    respx.post(URL).respond(200, content=_sse(event))
    assert await _collect(GeminiProvider(KEY, MODEL), _prompt()) == ["Es 12. "]


@respx.mock
async def test_un_mensaje_bloqueado_desde_el_inicio_es_un_error() -> None:
    respx.post(URL).respond(200, content=_sse({"promptFeedback": {"blockReason": "SAFETY"}}))
    with pytest.raises(GeminiError) as error:
        await _collect(GeminiProvider(KEY, MODEL), _prompt())
    assert error.value.code == "prompt_blocked"


@respx.mock
async def test_una_respuesta_cortada_por_seguridad_entrega_lo_previo_y_falla() -> None:
    respx.post(URL).respond(200, content=_sse(_text("Primero. "), _text("", "SAFETY")))
    delivered: list[str] = []
    with pytest.raises(GeminiError) as error:
        async for chunk in GeminiProvider(KEY, MODEL).stream(_prompt()):
            delivered.append(chunk)
    assert delivered == ["Primero. "] and error.value.code == "response_blocked"


@respx.mock
async def test_un_evento_con_basura_es_un_error_sin_el_contenido() -> None:
    respx.post(URL).respond(200, content=b"data: esto-no-es-json\r\n\r\n")
    with pytest.raises(GeminiError) as error:
        await _collect(GeminiProvider(KEY, MODEL), _prompt())
    assert error.value.code == "bad_event" and "esto-no" not in str(error.value)


# ---- errores y plazos --------------------------------------------------------------------


@respx.mock
@pytest.mark.parametrize("status", [400, 401, 403, 429, 500, 503])
async def test_los_errores_http_solo_dejan_un_codigo(status: int) -> None:
    respx.post(URL).respond(status, json={"error": {"message": f"detalle con {KEY} y 7 + 5"}})
    with pytest.raises(GeminiError) as error:
        await _collect(GeminiProvider(KEY, MODEL), _prompt())
    assert error.value.code == f"http_{status}"
    assert KEY not in str(error.value) and "7 + 5" not in str(error.value)


@respx.mock
async def test_un_fallo_de_red_no_filtra_la_url_ni_la_clave() -> None:
    respx.post(URL).mock(side_effect=httpx.ConnectError(f"no hay red para {URL} con {KEY}"))
    with pytest.raises(GeminiError) as error:
        await _collect(GeminiProvider(KEY, MODEL), _prompt())
    assert error.value.code == "transport"
    assert KEY not in repr(error.value) and "generativelanguage" not in repr(error.value)


class _SlowStream(httpx.AsyncByteStream):
    async def __aiter__(self) -> AsyncIterator[bytes]:
        await asyncio.sleep(1.0)
        yield _sse(_text("tarde"))


@respx.mock
async def test_si_el_primer_fragmento_tarda_demasiado_se_corta() -> None:
    respx.post(URL).mock(return_value=httpx.Response(200, stream=_SlowStream()))
    provider = GeminiProvider(KEY, MODEL, first_chunk_seconds=0.05)
    with pytest.raises(GeminiError) as error:
        await _collect(provider, _prompt())
    assert error.value.code == "timeout_first_chunk"


# ---- configuración -----------------------------------------------------------------------


def _settings(**kwargs: Any) -> Settings:
    return Settings(_env_file=None, app_env="test", **kwargs)


def test_gemini_exige_clave_y_modelo_sin_valores_por_defecto() -> None:
    with pytest.raises(ValueError) as error:
        _settings(ai_provider="gemini")
    assert "GEMINI_API_KEY" in str(error.value) and "GEMINI_MODEL" in str(error.value)


@pytest.mark.parametrize("model", ["gemini-flash-latest", "x-LATEST", "modelo-latest"])
def test_el_alias_latest_se_rechaza(model: str) -> None:
    with pytest.raises(ValueError) as error:
        _settings(ai_provider="gemini", gemini_api_key=KEY, gemini_model=model)
    assert "-latest" in str(error.value)


@pytest.mark.parametrize("model", ["a/b", "modelo con espacios", "../etc", "m?x=1", "ab"])
def test_un_nombre_de_modelo_raro_se_rechaza(model: str) -> None:
    with pytest.raises(ValueError):
        _settings(ai_provider="gemini", gemini_api_key=KEY, gemini_model=model)


def test_la_clave_no_aparece_en_repr_ni_en_los_errores_de_configuracion() -> None:
    settings = _settings(ai_provider="gemini", gemini_api_key=KEY, gemini_model=MODEL)
    assert KEY not in repr(settings) and KEY not in str(settings)
    with pytest.raises(ValueError) as error:
        _settings(ai_provider="gemini", gemini_api_key=KEY, gemini_model="x-latest")
    assert KEY not in str(error.value)


def test_la_fabrica_construye_gemini_con_el_modelo_elegido() -> None:
    provider = build_provider(
        _settings(ai_provider="gemini", gemini_api_key=KEY, gemini_model=MODEL)
    )
    assert isinstance(provider, GeminiProvider)
    assert MODEL in provider._url  # noqa: SLF001


def test_por_defecto_sigue_siendo_el_simulado() -> None:
    settings = _settings()
    assert settings.ai_provider == "mock" and settings.gemini_model == ""


# ---- de extremo a extremo con el servidor ---------------------------------------------------


@respx.mock
def test_el_servidor_no_registra_la_clave_ni_el_texto_ante_un_error_del_proveedor(
    log_stream: io.StringIO,
) -> None:
    import time
    import uuid

    import jwt
    from fastapi.testclient import TestClient

    from app.main import create_app
    from tests.fakes import FakeGateway

    tutor = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
    perfil = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
    secret = "secreto-hs256-solo-para-pruebas-0123456789"
    settings = _settings(
        ai_provider="gemini",
        gemini_api_key=KEY,
        gemini_model=MODEL,
        supabase_jwt_secret=secret,
    )
    gateway = FakeGateway(outcomes={(tutor, perfil): "ok"}, grades={(tutor, perfil): 1})
    respx.post(URL).respond(500, json={"error": f"{KEY} 7 + 5"})
    client = TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)
    claims = {
        "sub": str(tutor),
        "aud": "authenticated",
        "iss": "http://127.0.0.1:54321/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    token = jwt.encode(claims, secret, algorithm="HS256")
    response = client.post(
        f"/v1/students/{perfil}/explanations",
        json={"topic": "1-08", "exercise": "¿Cuánto es 7 + 5?"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert '"code": "provider_error"' in response.text
    logs = log_stream.getvalue()
    assert KEY not in logs and "7 + 5" not in logs and "http_500" in logs
    assert KEY not in response.text


def test_el_nivel_de_razonamiento_se_envia_solo_si_esta_configurado() -> None:
    with_level = build_request_body(_prompt(), 300, "low")
    assert with_level["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}
    without = build_request_body(_prompt(), 300, "")
    assert "thinkingConfig" not in without["generationConfig"]


def test_por_defecto_el_razonamiento_es_bajo_y_hay_margen_de_tokens() -> None:
    settings = _settings()
    assert settings.gemini_thinking_level == "low"
    assert settings.gemini_max_output_tokens >= 1024
