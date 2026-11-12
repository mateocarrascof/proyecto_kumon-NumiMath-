"""T27: el tutor titular ve y borra las hojas guardadas de su hijo.

- Ver (lista y detalle): zona del tutor, con el token del PIN activo. Sin el perfil propio, SIEMPRE
  el mismo 404, exista o no el perfil o la hoja. Funciona aunque el consentimiento esté revocado
  (derecho del titular, como borrar el perfil).
- Borrar (una o todas): el PIN debe haberse verificado hace menos de 2 minutos
  (`FreshParentalTutorDep`, como al quitar un docente). Es definitivo y el docente deja de verlas
  de inmediato.
- Nunca se registra contenido ni ids de niños: solo códigos.
Reglas: docs/SPEC.md ("Hojas guardadas").
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel

from app.ai.topics import ASSIGNMENT_TOPIC, topic_label
from app.db.gateway import Gateway, GatewayError
from app.deps import FreshParentalTutorDep, ParentalTutorDep
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.routes.sheets import Stroke

router = APIRouter(prefix="/v1/students", tags=["sheets"])
logger = get_logger("mathtutor.tutor_sheets")
_NOT_FOUND = "No encontramos esa hoja."
PAGE_DEFAULT = 30
PAGE_MAX = 50


class TutorSheetItemOut(BaseModel):
    id: uuid.UUID
    label: str
    tutor_task: bool
    correct: bool
    statement: str
    saved_at: datetime


class TutorSheetsOut(BaseModel):
    items: list[TutorSheetItemOut]
    has_more: bool
    next_offset: int | None
    total: int


class TutorSheetOut(TutorSheetItemOut):
    child_answer: str
    correct_answer: str
    strokes: list[Stroke]


class DeletedOut(BaseModel):
    deleted: int


def _gateway(request: Request) -> Gateway:
    gateway: Gateway = request.app.state.gateway
    return gateway


def _item(topic: str, statement: str) -> tuple[str, bool, str]:
    task = topic == ASSIGNMENT_TOPIC
    # Defensa en profundidad: la base ya guarda "Tarea del tutor", aquí se vuelve a imponer.
    return topic_label(0, topic), task, "Tarea del tutor" if task else statement


@router.get("/{student_id}/sheets")
async def list_sheets(
    student_id: uuid.UUID,
    tutor: ParentalTutorDep,
    request: Request,
    response: Response,
    offset: Annotated[int, Query(ge=0, le=5_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = PAGE_DEFAULT,
) -> TutorSheetsOut:
    response.headers["Cache-Control"] = "no-store"
    try:
        page = await _gateway(request).list_student_sheets(
            tutor.tutor_id, student_id, offset, limit
        )
    except GatewayError as exc:
        log_event(logger, "tutor_sheets.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if page is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    items = []
    for i in page.items:
        label, task, statement = _item(i.topic, i.statement)
        items.append(
            TutorSheetItemOut(
                id=i.id,
                label=label,
                tutor_task=task,
                correct=i.correct,
                statement=statement,
                saved_at=i.saved_at,
            )
        )
    return TutorSheetsOut(
        items=items,
        has_more=page.has_more,
        next_offset=offset + len(page.items) if page.has_more else None,
        total=page.total,
    )


@router.get("/{student_id}/sheets/{sheet_id}")
async def get_sheet(
    student_id: uuid.UUID,
    sheet_id: uuid.UUID,
    tutor: ParentalTutorDep,
    request: Request,
    response: Response,
) -> TutorSheetOut:
    response.headers["Cache-Control"] = "no-store"
    try:
        sheet = await _gateway(request).get_student_sheet(tutor.tutor_id, student_id, sheet_id)
    except GatewayError as exc:
        log_event(logger, "tutor_sheets.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if sheet is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    try:
        strokes = [Stroke.model_validate(s) for s in sheet.strokes]
    except ValueError:
        log_event(logger, "tutor_sheets.read_failed", code="bad_strokes")
        raise ApiError(503, "service_unavailable") from None
    label, task, statement = _item(sheet.topic, sheet.statement)
    return TutorSheetOut(
        id=sheet.id,
        label=label,
        tutor_task=task,
        correct=sheet.correct,
        statement=statement,
        saved_at=sheet.saved_at,
        child_answer=sheet.child_answer,
        correct_answer=sheet.correct_answer,
        strokes=strokes,
    )


@router.delete("/{student_id}/sheets/{sheet_id}", status_code=204)
async def delete_sheet(
    student_id: uuid.UUID, sheet_id: uuid.UUID, tutor: FreshParentalTutorDep, request: Request
) -> Response:
    """Borra UNA hoja (definitivo). El PIN debe ser reciente."""
    try:
        outcome = await _gateway(request).delete_student_sheet(tutor.tutor_id, student_id, sheet_id)
    except GatewayError as exc:
        log_event(logger, "tutor_sheets.delete_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome != "ok":
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    log_event(logger, "tutor_sheets.deleted", outcome="one")
    return Response(status_code=204)


@router.delete("/{student_id}/sheets")
async def delete_all_sheets(
    student_id: uuid.UUID, tutor: FreshParentalTutorDep, request: Request
) -> DeletedOut:
    """Borra TODAS las hojas del perfil (definitivo) y dice cuántas. El PIN debe ser reciente."""
    try:
        deleted = await _gateway(request).delete_student_sheets(tutor.tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "tutor_sheets.delete_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if deleted is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    log_event(logger, "tutor_sheets.deleted", outcome="all")
    return DeletedOut(deleted=deleted)
