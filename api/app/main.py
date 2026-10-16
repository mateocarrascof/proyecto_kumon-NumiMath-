"""Punto de entrada: `uvicorn app.main:app` (desde la carpeta api/)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.factory import build_provider
from app.ai.provider import AIProvider
from app.auth.jwt import TokenVerifier
from app.config import Settings, get_settings
from app.db.gateway import Gateway
from app.db.supabase_gateway import SupabaseGateway
from app.errors import install_error_handlers
from app.logging import configure_logging
from app.middleware import BodySizeLimitMiddleware, RequestContextMiddleware
from app.routes import exercises, explanations, health, progress, students


def create_app(
    settings: Settings | None = None,
    gateway: Gateway | None = None,
    provider: AIProvider | None = None,
) -> FastAPI:
    """`gateway` y `provider` permiten inyectar dobles en pruebas y en la demo."""
    settings = settings or get_settings()
    configure_logging()
    db_gateway: Gateway = gateway or SupabaseGateway(settings)
    ai_provider: AIProvider = provider or build_provider(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await db_gateway.aclose()
        provider_close = getattr(ai_provider, "aclose", None)
        if provider_close is not None:
            await provider_close()

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
    app.state.ai_provider = ai_provider

    # Orden: lo último que se agrega es lo más externo. El límite de tamaño va DENTRO del contexto
    # de petición (para registrar y devolver el id) y CORS por fuera de todo.
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    app.add_middleware(RequestContextMiddleware)
    origins = settings.cors_origin_list
    if origins:
        # Último en agregarse = más externo: las respuestas de error también llevan cabeceras CORS.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type"],
            allow_credentials=False,
            max_age=600,
        )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(students.router)
    app.include_router(explanations.router)
    app.include_router(exercises.router)
    app.include_router(progress.router)
    return app


app = create_app()
