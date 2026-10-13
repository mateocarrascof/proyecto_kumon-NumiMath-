"""Punto de entrada: `uvicorn app.main:app` (desde la carpeta api/)."""

from __future__ import annotations

from fastapi import FastAPI

from app.config import Settings, get_settings
from app.errors import install_error_handlers
from app.logging import configure_logging
from app.middleware import RequestContextMiddleware
from app.routes import health


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()

    production = settings.app_env == "production"
    app = FastAPI(
        title="Math tutor API",
        # La documentación interactiva no se expone en producción.
        docs_url=None if production else "/docs",
        redoc_url=None,
        openapi_url=None if production else "/openapi.json",
    )
    app.state.settings = settings

    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
