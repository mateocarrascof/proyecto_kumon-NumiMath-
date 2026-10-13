"""Middleware ASGI: identificador de petición y registro de cada respuesta.

Es ASGI puro (no `BaseHTTPMiddleware`) para no interferir con las respuestas en streaming.
No registra rutas con parámetros, consultas ni cuerpos: solo la plantilla de la ruta.
"""

from __future__ import annotations

import re
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.logging import get_logger, log_event

_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
logger = get_logger("mathtutor.http")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = ""
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        request_id = incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id

        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            route = getattr(scope.get("route"), "path", "unmatched")
            log_event(
                logger,
                "request.completed",
                request_id=request_id,
                method=scope.get("method", ""),
                route=route,
                status=status_holder["status"],
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
