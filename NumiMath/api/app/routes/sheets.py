"""Guardar la hoja del papel para calcular (CU-A22). El niño no tiene cuenta: usa el JWT del tutor.

Se guarda DESPUÉS de responder (junto a un intento real) y solo si el perfil tiene un docente
vinculado activo; si no, o si algo falla, la respuesta es un `saved: false` tranquilo (el ejercicio
ya quedó registrado). Privacidad (docs/privacy/inventario-datos.md, "Hojas guardadas"):
- Solo trazos vectoriales (puntos, color, grosor, goma): sin imágenes ni metadatos del dispositivo
  (el cuerpo rechaza cualquier otro campo).
- El enunciado lo toma la base del intento y en las tareas del tutor nunca se guarda su texto.
- La respuesta del niño es solo un número (o fracción). Nada de esto llega a la IA ni a los logs.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.tokens import InvalidExercise, verify
from app.logging import get_logger, log_event
from app.routes.common import signing_key

router = APIRouter(prefix="/v1/students", tags=["sheets"])
logger = get_logger("mathtutor.sheets")

_EXPIRED = "Este ejercicio ya no es válido."

# La hoja mide 1200 x 900 (core/scratchpad). Topes: una hoja muy cargada pesa ~150 KB.
MAX_STROKES = 600
MAX_POINTS_PER_STROKE = 3_000
MAX_POINTS = 12_000
_Coord = Annotated[float, Field(ge=-100, le=1400)]


class Stroke(BaseModel):
    """Un trazo en coordenadas de la hoja. `eraser`: la goma borra lo anterior."""

    model_config = ConfigDict(extra="forbid")

    eraser: bool
    color: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{3,8}$")]
    width: Annotated[float, Field(gt=0, le=60)]
    points: Annotated[
        list[tuple[_Coord, _Coord]], Field(min_length=1, max_length=MAX_POINTS_PER_STROKE)
    ]


class _SheetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strokes: Annotated[list[Stroke], Field(max_length=MAX_STROKES)]

    @model_validator(mode="after")
    def _total_points(self) -> _SheetBody:
        if sum(len(s.points) for s in self.strokes) > MAX_POINTS:
            raise ValueError("too_many_points")
        return self


class PracticeSheetIn(_SheetBody):
    token: Annotated[str, Field(min_length=10, max_length=600)]
    answer: Annotated[int, Field(ge=0, le=1_000_000)]
    answer_den: Annotated[int, Field(ge=1, le=1000)] | None = None


class TaskSheetIn(_SheetBody):
    answer: Annotated[int, Field(ge=0, le=1_000_000)]


class SavedOut(BaseModel):
    saved: bool


class EnabledOut(BaseModel):
    enabled: bool


@router.get("/{student_id}/sheets/enabled")
async def sheets_enabled(student: AuthorizedStudentDep, request: Request) -> EnabledOut:
    """¿Se guardarían las hojas de este perfil? Solo con un docente vinculado cuyo texto las cubre.
    Así el dispositivo no sube los trazos si no hay a quién mostrárselos. Ante un fallo: `false`."""
    gateway: Gateway = request.app.state.gateway
    try:
        enabled = await gateway.student_has_sheet_link(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "sheet.enabled_failed", code=f"gateway_{exc.reason}")
        return EnabledOut(enabled=False)
    return EnabledOut(enabled=enabled)


def _compact(strokes: list[Stroke]) -> list[dict[str, object]]:
    """Puntos a enteros: la cuadrícula es de 24 px, no hace falta más precisión (y pesa menos)."""
    return [
        {
            "eraser": s.eraser,
            "color": s.color,
            "width": round(s.width, 1),
            "points": [[round(x), round(y)] for x, y in s.points],
        }
        for s in strokes
    ]


async def _save(
    request: Request,
    student: AuthorizedStudentDep,
    exercise_id: uuid.UUID,
    child_answer: str,
    correct: bool | None,
    correct_answer: str | None,
    strokes: list[Stroke],
) -> SavedOut:
    gateway: Gateway = request.app.state.gateway
    try:
        status = await gateway.save_student_sheet(
            student.tutor_id,
            student.student_id,
            exercise_id,
            child_answer,
            correct,
            correct_answer,
            _compact(strokes),
        )
    except GatewayError as exc:
        log_event(logger, "sheet.save_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if status == "rate_limited":
        log_event(logger, "sheet.rate_limited")
        raise ApiError(
            429, "rate_limited", message="Demasiados guardados seguidos. Espera un poco."
        )
    if status != "ok":
        # no_link es lo normal sin docente; los demás casos solo se cuentan (sin ids ni contenido).
        log_event(logger, "sheet.not_saved", code=status)
    return SavedOut(saved=status == "ok")


@router.post("/{student_id}/exercises/sheet")
async def save_exercise_sheet(
    body: PracticeSheetIn, student: AuthorizedStudentDep, request: Request
) -> SavedOut:
    """Hoja de un ejercicio generado por la app, ya respondido."""
    try:
        verified = verify(signing_key(request), body.token, student.student_id)
    except InvalidExercise:
        raise ApiError(422, "exercise_invalid", message=_EXPIRED) from None
    exercise = verified.exercise
    if exercise.is_fraction != (body.answer_den is not None):
        raise ApiError(422, "invalid_request")
    # Misma regla de corrección que la respuesta: las fracciones equivalentes cuentan.
    if exercise.answer_den is not None and body.answer_den is not None:
        correct = body.answer * exercise.answer_den == exercise.answer * body.answer_den
    else:
        correct = body.answer == exercise.answer
    child = str(body.answer) if body.answer_den is None else f"{body.answer}/{body.answer_den}"
    right = (
        str(exercise.answer)
        if exercise.answer_den is None
        else f"{exercise.answer}/{exercise.answer_den}"
    )
    return await _save(request, student, verified.exercise_id, child, correct, right, body.strokes)


@router.post("/{student_id}/assignments/{assignment_id}/sheet")
async def save_task_sheet(
    assignment_id: uuid.UUID, body: TaskSheetIn, student: AuthorizedStudentDep, request: Request
) -> SavedOut:
    """Hoja de una tarea del tutor ya respondida: la base pone "Tarea del tutor" y la respuesta."""
    return await _save(request, student, assignment_id, str(body.answer), None, None, body.strokes)
