"""Piezas comunes de las rutas de ejercicios (práctica, diagnóstico y lote sin conexión).

Vivían como privadas en `routes/exercises.py` y otras rutas las importaban desde ahí; aquí quedan
como parte pública de las rutas, sin cambiar su comportamiento ni sus eventos de log.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import Request

from app.db.gateway import Gateway, GatewayError
from app.errors import ApiError
from app.logging import get_logger, log_event

# Mismo logger que antes: los eventos `exercise.denied` siguen saliendo con el mismo nombre.
logger = get_logger("mathtutor.exercises")


def signing_key(request: Request) -> bytes:
    """Clave de firma de los ejercicios. Falla cerrado si no está configurada."""
    key = request.app.state.settings.exercise_signing_key.get_secret_value()
    if not key:
        # Falla cerrado: sin clave de firma no se emiten ni se corrigen ejercicios.
        log_event(logger, "exercise.denied", code="signing_key_missing")
        raise ApiError(503, "service_unavailable")
    return key.encode()


async def student_grade(request: Request, tutor_id: UUID, student_id: UUID) -> int:
    """Curso del perfil leído de la base (nunca del cliente). 403 si no es del tutor."""
    gateway: Gateway = request.app.state.gateway
    try:
        grade = await gateway.get_student_grade(tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "exercise.denied", stage="grade", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if grade is None:
        raise ApiError(403, "forbidden")
    return grade
