from __future__ import annotations

import io
import logging
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.logging import JsonFormatter
from app.main import create_app

_ENV_VARS = (
    "APP_ENV",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWKS_URL",
    "SUPABASE_JWT_SECRET",
    "JWT_AUDIENCE",
    "JWT_ISSUER",
    "AI_PROVIDER",
    "COST_PER_EXPLANATION",
    "STUDENT_DAILY_LIMIT",
    "TUTOR_DAILY_LIMIT",
    "STREAM_MAX_SECONDS",
    "STREAM_RECHECK_SECONDS",
    "CORS_ORIGINS",
    "MAX_BODY_BYTES",
    "GEMINI_MODEL",
    "EXERCISE_SIGNING_KEY",
    "EXERCISE_TOKEN_TTL_SECONDS",
    "HMAC_KEYS",
    "HMAC_ACTIVE_VERSION",
)


@pytest.fixture(autouse=True)
def _hermetic_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Las pruebas no dependen de variables de entorno del sistema (ni de un .env local)."""
    for name in _ENV_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def settings() -> Settings:
    # `_env_file=None`: las pruebas no leen un .env local por accidente.
    return Settings(_env_file=None, app_env="test")


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    # raise_server_exceptions=False: se comprueba la respuesta 500 real, no la excepción.
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def log_stream() -> Iterator[io.StringIO]:
    """Captura lo que el servidor escribiría en sus logs (ya formateado y redactado)."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger("mathtutor")
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    try:
        yield stream
    finally:
        root.removeHandler(handler)
