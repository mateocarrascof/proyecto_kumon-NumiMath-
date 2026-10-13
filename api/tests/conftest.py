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
