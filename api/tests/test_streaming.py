from __future__ import annotations

import asyncio
import contextlib
import io
import json
import time
import uuid
from collections.abc import AsyncIterator, Sequence
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.access.authorize import AuthorizedStudent
from app.ai.mock_provider import MockProvider
from app.ai.prompt import build_prompt
from app.ai.provider import MathPrompt
from app.config import Settings
from app.db.gateway import GatewayError
from app.main import create_app
from app.safety.input_filter import check_input
from app.streaming.pipeline import StreamConfig, sse_event, stream_explanation
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
STUDENT = AuthorizedStudent(tutor_id=TUTOR, student_id=PERFIL)
CONFIG = StreamConfig(max_seconds=30, recheck_seconds=10)


# --- ayudas --------------------------------------------------------------------------------


class ScriptedProvider:
    """Entrega fragmentos con retardo opcional y registra si se cerró y qué prompt recibió."""

    def __init__(self, chunks: Sequence[str] = (), delay: float = 0.0, hang: bool = False) -> None:
        self._chunks = list(chunks)
        self._delay = delay
        self._hang = hang
        self.closed = False
        self.prompts: list[MathPrompt] = []

    async def stream(self, prompt: MathPrompt) -> AsyncIterator[str]:
        self.prompts.append(prompt)
        try:
            for chunk in self._chunks:
                if self._delay:
                    await asyncio.sleep(self._delay)
                yield chunk
            if self._hang:
                await asyncio.sleep(3600)
        finally:
            self.closed = True


class BrokenProvider:
    def stream(self, prompt: MathPrompt) -> AsyncIterator[str]:
        return self._gen()

    async def _gen(self) -> AsyncIterator[str]:
        yield "Empiezo bien. "
        raise RuntimeError("falló con datos: ana@example.com")


def _prompt(texto: str = "¿Cuánto es 7 + 5?") -> MathPrompt:
    return build_prompt(1, "sumas_hasta_20", check_input(texto))


def _parse(raw: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for block in raw.strip().split("\n\n"):
        lines = block.splitlines()
        events.append(
            (lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: ")))
        )
    return events


async def _run(
    provider: Any,
    gateway: FakeGateway | None = None,
    config: StreamConfig = CONFIG,
    clock: Any = None,
) -> list[tuple[str, dict[str, Any]]]:
    kwargs: dict[str, Any] = {}
    if clock is not None:
        kwargs["clock"] = clock
    parts = [
        part
        async for part in stream_explanation(
            provider=provider,
            prompt=_prompt(),
            gateway=gateway or FakeGateway(default="ok"),
            student=STUDENT,
            config=config,
            **kwargs,
        )
    ]
    return _parse("".join(parts))


def _text(events: list[tuple[str, dict[str, Any]]]) -> str:
    return " ".join(data["text"] for name, data in events if name == "chunk")


# --- formato SSE -----------------------------------------------------------------------------


def test_un_evento_sse_escapa_los_saltos_de_linea() -> None:
    evento = sse_event("chunk", {"text": "línea 1\nlínea 2"})
    assert evento.count("\n") == 3  # event, data y la línea en blanco final
    assert evento.endswith("\n\n")
    assert json.loads(evento.splitlines()[1].removeprefix("data: ")) == {"text": "línea 1\nlínea 2"}


# --- pipeline ----------------------------------------------------------------------------------


async def test_una_explicacion_normal_termina_con_done() -> None:
    eventos = await _run(MockProvider())
    assert eventos[-1] == ("done", {})
    assert "El resultado es 12" in _text(eventos)
    assert all(nombre == "chunk" for nombre, _ in eventos[:-1])


async def test_una_oracion_insegura_corta_el_stream_y_no_se_envia() -> None:
    provider = ScriptedProvider(
        ["¡Vamos a sumar 7 + 5! ", "Antes dime tu apellido. ", "El resultado es 12. "]
    )
    eventos = await _run(provider)
    assert [nombre for nombre, _ in eventos] == ["chunk", "error"]
    assert eventos[-1][1]["code"] == "output_blocked"
    assert "apellido" not in json.dumps(eventos)
    assert provider.closed is True


async def test_una_revocacion_a_mitad_de_la_respuesta_corta_el_stream() -> None:
    provider = ScriptedProvider(["Paso número uno de la suma. "] * 30, delay=0.02)
    gateway = FakeGateway(sequence=["ok", "ok", "consent_required"])
    eventos = await _run(provider, gateway, StreamConfig(max_seconds=30, recheck_seconds=0.03))
    assert eventos[-1][0] == "error"
    assert eventos[-1][1]["code"] == "access_revoked"
    assert 0 < len([e for e in eventos if e[0] == "chunk"]) < 30
    assert provider.closed is True


async def test_la_revocacion_corta_aunque_el_proveedor_este_en_silencio() -> None:
    provider = ScriptedProvider(hang=True)
    gateway = FakeGateway(sequence=["student_blocked"])
    inicio = time.monotonic()
    eventos = await asyncio.wait_for(
        _run(provider, gateway, StreamConfig(max_seconds=30, recheck_seconds=0.05)), timeout=3
    )
    assert eventos[-1][1]["code"] == "access_revoked"
    assert time.monotonic() - inicio < 1.5
    assert provider.closed is True


async def test_un_error_de_la_base_al_rechequear_corta_el_stream() -> None:
    provider = ScriptedProvider(["Sigo contando. "] * 20, delay=0.02)
    gateway = FakeGateway(error=GatewayError("transport"), error_after=1)
    eventos = await _run(provider, gateway, StreamConfig(max_seconds=30, recheck_seconds=0.03))
    assert eventos[-1][1]["code"] == "service_unavailable"
    assert provider.closed is True


async def test_la_duracion_maxima_corta_el_stream() -> None:
    reloj = iter(float(n) for n in range(10_000))
    provider = ScriptedProvider(["Sigo contando uno, dos, tres. "] * 200)
    eventos = await _run(
        provider,
        config=StreamConfig(max_seconds=5, recheck_seconds=1000),
        clock=lambda: next(reloj),
    )
    assert eventos[-1][1]["code"] == "stream_timeout"
    assert provider.closed is True


async def test_si_el_proveedor_falla_no_se_filtra_el_detalle() -> None:
    eventos = await _run(BrokenProvider())
    assert eventos[-1][1]["code"] == "provider_error"
    assert "ana@example.com" not in json.dumps(eventos)


async def test_si_el_cliente_se_desconecta_se_cierra_al_proveedor() -> None:
    provider = ScriptedProvider(hang=True)
    gateway = FakeGateway(default="ok")

    async def consumir() -> None:
        async for _ in stream_explanation(
            provider=provider,
            prompt=_prompt(),
            gateway=gateway,
            student=STUDENT,
            config=CONFIG,
        ):
            pass

    tarea = asyncio.create_task(consumir())
    await asyncio.sleep(0.05)
    tarea.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await tarea
    await asyncio.sleep(0)
    assert provider.closed is True


# --- HTTP de extremo a extremo (con dobles) ------------------------------------------------------


def _token(sub: uuid.UUID = TUTOR) -> str:
    now = int(time.time())
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": now + 600,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _client(gateway: FakeGateway, provider: Any = None) -> TestClient:
    settings = Settings(
        _env_file=None, app_env="test", supabase_url=URL, supabase_jwt_secret=SECRET
    )
    app = create_app(settings, gateway=gateway, provider=provider or MockProvider())
    return TestClient(app, raise_server_exceptions=False)


def _gateway(**kwargs: Any) -> FakeGateway:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"}, **kwargs)
    gateway.grades[(TUTOR, PERFIL)] = 1
    return gateway


def _post(client: TestClient, body: dict[str, Any], token: str | None = None) -> Any:
    headers = {"Authorization": f"Bearer {token or _token()}"}
    return client.post(f"/v1/students/{PERFIL}/explanations", json=body, headers=headers)


OK_BODY = {"topic": "sumas_hasta_20", "exercise": "¿Cuánto es 7 + 5?"}


def test_http_explicacion_completa_por_sse() -> None:
    gateway = _gateway()
    with _client(gateway).stream(
        "POST",
        f"/v1/students/{PERFIL}/explanations",
        json=OK_BODY,
        headers={"Authorization": f"Bearer {_token()}"},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-store"
        eventos = _parse("".join(response.iter_text()))
    assert eventos[-1] == ("done", {})
    assert "El resultado es 12" in _text(eventos)
    assert len(gateway.usage_calls) == 1
    assert gateway.touches == [(TUTOR, PERFIL)]


def test_http_la_ia_solo_recibe_curso_tema_y_ejercicio() -> None:
    provider = ScriptedProvider(["El resultado es 12. "])
    gateway = _gateway()
    # El cliente intenta imponer un curso y mandar datos extra: se ignoran.
    cuerpo = {**OK_BODY, "grade": 4, "nickname": "Ana", "tutor_id": str(uuid.uuid4())}
    with _client(gateway, provider).stream(
        "POST",
        f"/v1/students/{PERFIL}/explanations",
        json=cuerpo,
        headers={"Authorization": f"Bearer {_token()}"},
    ) as response:
        response.read()
    assert provider.prompts == [
        MathPrompt(grade=1, topic="sumas_hasta_20", exercise="¿Cuánto es 7 + 5?")
    ]


def test_http_un_mensaje_rechazado_no_consume_cuota_ni_llega_a_la_ia() -> None:
    provider = ScriptedProvider(["no debería usarse. "])
    gateway = _gateway()
    respuesta = _post(
        _client(gateway, provider), {"topic": "sumas_hasta_20", "exercise": "me llamo pedro, 2+2"}
    )
    assert respuesta.status_code == 422
    error = respuesta.json()["error"]
    assert error["code"] == "input_rejected"
    assert error["reason"] == "pii"
    assert "pedro" not in respuesta.text
    assert gateway.usage_calls == []
    assert provider.prompts == []


def test_http_un_tema_de_otro_curso_se_rechaza() -> None:
    gateway = _gateway()
    respuesta = _post(_client(gateway), {"topic": "division_con_resto", "exercise": "17 ÷ 5"})
    assert respuesta.status_code == 422
    assert respuesta.json()["error"]["code"] == "invalid_request"
    assert gateway.usage_calls == []


def test_http_superar_el_limite_responde_429_con_retry_after() -> None:
    gateway = _gateway(usage_override="student_limit")
    provider = ScriptedProvider(["no debería usarse. "])
    respuesta = _post(_client(gateway, provider), OK_BODY)
    assert respuesta.status_code == 429
    assert int(respuesta.headers["retry-after"]) >= 60
    assert respuesta.json()["error"]["scope"] == "student"
    assert provider.prompts == []


def test_http_sin_consentimiento_no_se_consume_cuota() -> None:
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "consent_required"})
    respuesta = _post(_client(gateway), OK_BODY)
    assert respuesta.status_code == 403
    assert respuesta.json()["error"]["code"] == "consent_required"
    assert gateway.usage_calls == []


def test_http_sin_token_es_401() -> None:
    respuesta = _client(_gateway()).post(f"/v1/students/{PERFIL}/explanations", json=OK_BODY)
    assert respuesta.status_code == 401


def test_http_si_la_base_falla_al_leer_el_curso_se_deniega() -> None:
    gateway = _gateway(grade_error=GatewayError("transport"))
    respuesta = _post(_client(gateway), OK_BODY)
    assert respuesta.status_code == 503
    assert gateway.usage_calls == []


def test_http_la_marca_de_actividad_es_de_mejor_esfuerzo() -> None:
    gateway = _gateway(touch_error=GatewayError("transport"))
    with _client(gateway).stream(
        "POST",
        f"/v1/students/{PERFIL}/explanations",
        json=OK_BODY,
        headers={"Authorization": f"Bearer {_token()}"},
    ) as response:
        assert response.status_code == 200
        eventos = _parse("".join(response.iter_text()))
    assert eventos[-1] == ("done", {})


def test_http_salida_insegura_de_la_ia_nunca_llega_al_cliente() -> None:
    provider = ScriptedProvider(["Entra a www.juegos.cl ahora. ", "El resultado es 12. "])
    with _client(_gateway(), provider).stream(
        "POST",
        f"/v1/students/{PERFIL}/explanations",
        json=OK_BODY,
        headers={"Authorization": f"Bearer {_token()}"},
    ) as response:
        cuerpo = "".join(response.iter_text())
    assert "juegos" not in cuerpo
    assert _parse(cuerpo)[-1][0] == "error"


def test_http_los_logs_no_contienen_texto_del_nino_ni_de_la_ia(log_stream: io.StringIO) -> None:
    with _client(_gateway()).stream(
        "POST",
        f"/v1/students/{PERFIL}/explanations",
        json={"topic": "sumas_hasta_20", "exercise": "¿Cuánto es 7 + 5?"},
        headers={"Authorization": f"Bearer {_token()}"},
    ) as response:
        response.read()
    logs = log_stream.getvalue()
    assert "stream.started" in logs
    assert "stream.finished" in logs
    for texto in ("7 + 5", "El resultado es", "Cuánto es", str(PERFIL), str(TUTOR)):
        assert texto not in logs


@pytest.mark.parametrize("cuerpo", [{}, {"topic": "sumas_hasta_20"}, {"exercise": "2+2"}])
def test_http_cuerpo_incompleto_es_422_generico(cuerpo: dict[str, str]) -> None:
    respuesta = _post(_client(_gateway()), cuerpo)
    assert respuesta.status_code == 422
    assert respuesta.json()["error"]["code"] == "invalid_request"
