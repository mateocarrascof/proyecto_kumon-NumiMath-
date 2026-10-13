"""Punto de entrada: `uvicorn app.main:app` (desde la carpeta api/)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.auth.jwt import TokenVerifier
from app.config import Settings, get_settings
from app.db.gateway import Gateway
from app.db.supabase_gateway import SupabaseGateway
from app.errors import install_error_handlers
from app.logging import configure_logging
from app.middleware import RequestContextMiddleware
from app.routes import health, students


def create_app(settings: Settings | None = None, gateway: Gateway | None = None) -> FastAPI:
    """`gateway` permite inyectar un doble en las pruebas; por defecto, Supabase."""
    settings = settings or get_settings()
    configure_logging()
    db_gateway: Gateway = gateway or SupabaseGateway(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await db_gateway.aclose()

    production = settings.app_env == "production"
    app = FastAPI(
        lifespan=lifespan,
        title="Math tutor API",
        # La documentación interactiva no se expone en producción.
        docs_url=None if production else "/docs",
        redoc_url=None,
        openapi_url=None if production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.token_verifier = TokenVerifier(settings)
    app.state.gateway = db_gateway

    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(students.router)
    return app


app = create_app()
