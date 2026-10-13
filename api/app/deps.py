"""Dependencias de FastAPI compartidas por las rutas."""

from __future__ import annotations

from typing import Annotated

import anyio.to_thread
from fastapi import Depends, Request

from app.auth.jwt import AuthenticatedTutor, InvalidToken, TokenVerifier
from app.errors import ApiError
from app.logging import get_logger, log_event

logger = get_logger("mathtutor.auth")


async def get_current_tutor(request: Request) -> AuthenticatedTutor:
    """Comprobación 1 del ADR 0001: JWT válido; `tutor_id` es el `sub` del token.

    Responde siempre 401 genérico: no se explica qué falló.
    """
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        log_event(logger, "auth.rejected", code="missing_token")
        raise ApiError(401, "unauthorized")

    verifier: TokenVerifier = request.app.state.token_verifier
    try:
        # La verificación puede consultar el JWKS (E/S bloqueante): fuera del bucle de eventos.
        return await anyio.to_thread.run_sync(verifier.verify, token)
    except InvalidToken as exc:
        log_event(logger, "auth.rejected", code=exc.reason)
        raise ApiError(401, "unauthorized") from None


# Uso en rutas: `async def ruta(tutor: CurrentTutor): ...`
CurrentTutor = Annotated[AuthenticatedTutor, Depends(get_current_tutor)]
