"""Camino de apoyo de extremo a extremo: no consume cuota, no llega a la IA, no se registra."""

from __future__ import annotations

import io
import time
import uuid
from collections.abc import AsyncIterator

import jwt
from fastapi.testclient import TestClient

from app.ai.provider import MathPrompt
from app.config import Settings
from app.main import create_app
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")


class SpyProvider:
    def __init__(self) -> None:
        self.prompts: list[MathPrompt] = []

    async def stream(self, prompt: MathPrompt) -> AsyncIterator[str]:
        self.prompts.append(prompt)
        yield "nunca debería llamarse. "


def _post(text: str) -> tuple[TestClient, FakeGateway, SpyProvider, object]:
    settings = Settings(
        _env_file=None, app_env="test", supabase_url=URL, supabase_jwt_secret=SECRET
    )
    gateway = FakeGateway(outcomes={(TUTOR, PERFIL): "ok"}, grades={(TUTOR, PERFIL): 1})
    provider = SpyProvider()
    client = TestClient(
        create_app(settings, gateway=gateway, provider=provider), raise_server_exceptions=False
    )
    claims = {
        "sub": str(TUTOR),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    token = jwt.encode(claims, SECRET, algorithm="HS256")
    response = client.post(
        f"/v1/students/{PERFIL}/explanations",
        json={"topic": "1-08", "exercise": text},
        headers={"Authorization": f"Bearer {token}"},
    )
    return client, gateway, provider, response


def test_un_nino_angustiado_recibe_apoyo_sin_gastar_cuota_ni_llegar_a_la_ia() -> None:
    _, gateway, provider, response = _post("me quiero morir")
    body = response.json()["error"]  # type: ignore[attr-defined]
    assert response.status_code == 422  # type: ignore[attr-defined]
    assert body["reason"] == "needs_support"
    assert "adulto de confianza" in body["message"]
    assert gateway.usage_calls == []
    assert provider.prompts == []


def test_el_texto_del_nino_no_aparece_en_los_logs(log_stream: io.StringIO) -> None:
    _post("me quiero morir")
    assert "morir" not in log_stream.getvalue()
