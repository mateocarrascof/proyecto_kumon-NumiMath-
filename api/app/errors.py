"""Errores de la API: respuestas genéricas, sin datos del usuario ni detalles internos."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.logging import get_logger, log_event

# Mensajes cortos y genéricos. Nunca explican POR QUÉ un perfil ajeno "no existe" (ADR 0001).
MESSAGES: dict[str, str] = {
    "unauthorized": "No se pudo verificar tu sesión.",
    "forbidden": "No tienes acceso a este recurso.",
    "consent_required": "Debes aceptar la versión vigente de los términos y la política.",
    "rate_limited": "Alcanzaste el límite de uso por ahora. Intenta más tarde.",
    "invalid_request": "La solicitud no es válida.",
    "service_unavailable": "No pudimos verificar tu acceso. Intenta de nuevo en un momento.",
    "internal_error": "Ocurrió un error. Intenta de nuevo más tarde.",
}

logger = get_logger("mathtutor.errors")


class ApiError(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _body(request: Request, code: str) -> dict[str, dict[str, str]]:
    request_id = getattr(request.state, "request_id", "")
    return {
        "error": {
            "code": code,
            "message": MESSAGES.get(code, MESSAGES["internal_error"]),
            "request_id": request_id,
        }
    }


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        log_event(logger, "api_error", code=exc.code, status=exc.status_code)
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return JSONResponse(_body(request, exc.code), status_code=exc.status_code, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # El detalle por defecto de FastAPI repite el valor recibido: podría ser texto del niño.
        log_event(logger, "validation_error", code="invalid_request", status=422)
        return JSONResponse(_body(request, "invalid_request"), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Solo el TIPO de la excepción; su texto puede contener datos del usuario.
        log_event(logger, "unhandled_error", code=type(exc).__name__, status=500)
        return JSONResponse(_body(request, "internal_error"), status_code=500)
