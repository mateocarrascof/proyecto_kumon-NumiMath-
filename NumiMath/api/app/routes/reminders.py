"""Recordatorio de racha (CU-A9, RF-10, ADR 0003).

Solo guarda la PREFERENCIA del tutor por perfil (sí o no). El aviso lo programa el propio
dispositivo como notificación local: el servidor no envía notificaciones ni recibe datos del aviso.

Zona del tutor: exige el token parental (PIN vigente) además del JWT, y que el perfil sea suyo,
no esté en pausa y tenga consentimiento vigente (`ParentalStudentDep`). El niño nunca la cambia.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.db.gateway import Gateway, GatewayError
from app.deps import ParentalStudentDep
from app.errors import ApiError
from app.logging import get_logger, log_event

router = APIRouter(prefix="/v1/students", tags=["students"])
logger = get_logger("mathtutor.reminders")


class StreakReminderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class StreakReminderOut(BaseModel):
    enabled: bool


@router.put("/{student_id}/streak-reminder")
async def set_streak_reminder(
    body: StreakReminderIn, student: ParentalStudentDep, request: Request
) -> StreakReminderOut:
    gateway: Gateway = request.app.state.gateway
    try:
        outcome = await gateway.set_streak_reminder(
            student.tutor_id, student.student_id, body.enabled
        )
    except GatewayError as exc:
        log_event(logger, "reminder.denied", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome != "ok":
        raise ApiError(403, "forbidden")
    # Solo el código del evento: ni el perfil ni el valor.
    log_event(logger, "reminder.updated")
    return StreakReminderOut(enabled=body.enabled)
