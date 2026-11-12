"""Zona del docente: su perfil (D3) y la lectura de los alumnos vinculados (D4, D5, D7, D8).

SOLO LECTURA. Toda lectura de un niño pasa por `teacher_can_view` dentro de la base (vínculo
activo, consentimiento vigente, perfil no bloqueado y rol verificado). Sin acceso, la respuesta es
SIEMPRE el mismo 404, exista o no un niño con ese id. Privacidad (docs/privacy/inventario-datos.md):
- D4: apodo y curso.
- D5: estado actual por habilidad (sin tiempo típico ni racha).
- D7: solo desde `accepted_at` del vínculo, fecha sin hora, sin segundos de respuesta y sin el texto
  de las tareas del tutor; sin el diagnóstico.
- D6: ejercicios y aciertos por semana (8 semanas) desde `accepted_at`, sin diagnóstico ni juegos.
- D8: hojas guardadas desde `accepted_at` (trazos y respuestas), sin texto de tareas del tutor.
`CurrentTeacher` ya comprobó que el perfil existe (un docente eliminado con un token aún vigente
recibe 403).
Reglas: docs/SPEC.md ("Docentes y administradores").
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel

from app.ai.topics import ASSIGNMENT_TOPIC, topic_label
from app.curriculum.catalog import get_skill
from app.db.gateway import Gateway, GatewayError, TeacherProfile
from app.deps import CurrentTeacher
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.routes.sheets import Stroke
from app.weekly import WeekOut

router = APIRouter(prefix="/v1/teacher", tags=["teacher"])


class TeacherMe(BaseModel):
    name: str
    link_code: str


@router.get("/me")
async def my_profile(_: CurrentTeacher, request: Request, response: Response) -> TeacherMe:
    profile: TeacherProfile = request.state.teacher_profile
    response.headers["Cache-Control"] = "no-store"
    return TeacherMe(name=profile.name, link_code=profile.link_code)


logger = get_logger("mathtutor.teacher")
_NOT_FOUND = "No encontramos a ese alumno."
PAGE_DEFAULT = 30
PAGE_MAX = 50


class StudentOut(BaseModel):
    student_id: uuid.UUID
    nickname: str
    grade: int


class StudentsOut(BaseModel):
    students: list[StudentOut]


class SkillOut(BaseModel):
    code: str
    label: str
    module: str
    level: int
    block_total: int
    block_correct: int
    mastered: bool


class ProgressOut(BaseModel):
    nickname: str
    grade: int
    skills: list[SkillOut]


class HistoryItemOut(BaseModel):
    label: str
    tutor_task: bool
    exercise: str | None
    correct: bool
    level: int
    day: str


class HistoryOut(BaseModel):
    items: list[HistoryItemOut]
    has_more: bool
    next_offset: int | None


class EvolutionOut(BaseModel):
    weeks: list[WeekOut]


class SheetItemOut(BaseModel):
    id: uuid.UUID
    label: str
    tutor_task: bool
    correct: bool
    day: str


class SheetsOut(BaseModel):
    items: list[SheetItemOut]
    has_more: bool
    next_offset: int | None


class SheetOut(SheetItemOut):
    statement: str
    child_answer: str
    correct_answer: str
    strokes: list[Stroke]


def _gateway(request: Request) -> Gateway:
    gateway: Gateway = request.app.state.gateway
    return gateway


@router.get("/students")
async def my_students(teacher: CurrentTeacher, request: Request, response: Response) -> StudentsOut:
    """D4: los niños que el docente puede ver ahora. Solo apodo y curso."""
    response.headers["Cache-Control"] = "no-store"
    try:
        rows = await _gateway(request).teacher_students(teacher.tutor_id)
    except GatewayError as exc:
        log_event(logger, "teacher.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    return StudentsOut(
        students=[
            StudentOut(student_id=r.student_id, nickname=r.nickname, grade=r.grade) for r in rows
        ]
    )


@router.get("/students/{student_id}/progress")
async def student_progress(
    student_id: uuid.UUID, teacher: CurrentTeacher, request: Request, response: Response
) -> ProgressOut:
    """D5: estado actual por habilidad. 404 igual que si el niño no existiera, si no hay acceso."""
    response.headers["Cache-Control"] = "no-store"
    try:
        progress = await _gateway(request).teacher_student_progress(teacher.tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "teacher.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if progress is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    skills = []
    for state in progress.skills:
        skill = get_skill(state.code)
        skills.append(
            SkillOut(
                code=state.code,
                label=skill.name if skill else state.code,
                module=skill.module if skill else "",
                level=state.level,
                block_total=state.block_total,
                block_correct=state.block_correct,
                mastered=state.mastered,
            )
        )
    return ProgressOut(nickname=progress.nickname, grade=progress.grade, skills=skills)


@router.get("/students/{student_id}/history")
async def student_history(
    student_id: uuid.UUID,
    teacher: CurrentTeacher,
    request: Request,
    response: Response,
    offset: Annotated[int, Query(ge=0, le=5_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = PAGE_DEFAULT,
) -> HistoryOut:
    """D7: ejercicios desde `accepted_at`, paginado. 404 si no hay acceso."""
    response.headers["Cache-Control"] = "no-store"
    try:
        page = await _gateway(request).teacher_student_history(
            teacher.tutor_id, student_id, offset, limit
        )
    except GatewayError as exc:
        log_event(logger, "teacher.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if page is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    return HistoryOut(
        items=[
            HistoryItemOut(
                label=topic_label(0, i.topic),
                tutor_task=i.topic == ASSIGNMENT_TOPIC,
                # Defensa en profundidad: la base ya entrega null, pero aquí se vuelve a quitar.
                exercise=None if i.topic == ASSIGNMENT_TOPIC else i.exercise,
                correct=i.correct,
                level=i.level,
                day=i.day,
            )
            for i in page.items
        ],
        has_more=page.has_more,
        next_offset=offset + len(page.items) if page.has_more else None,
    )


@router.get("/students/{student_id}/evolution")
async def student_evolution(
    student_id: uuid.UUID, teacher: CurrentTeacher, request: Request, response: Response
) -> EvolutionOut:
    """D6: evolución semana a semana. Mismo 404 sin acceso."""
    response.headers["Cache-Control"] = "no-store"
    try:
        weeks = await _gateway(request).teacher_student_evolution(teacher.tutor_id, student_id)
    except GatewayError as exc:
        log_event(logger, "teacher.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if weeks is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    return EvolutionOut(weeks=[WeekOut(start=s, total=t, correct=c) for s, t, c in weeks])


@router.get("/students/{student_id}/sheets")
async def student_sheets(
    student_id: uuid.UUID,
    teacher: CurrentTeacher,
    request: Request,
    response: Response,
    offset: Annotated[int, Query(ge=0, le=5_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = PAGE_DEFAULT,
) -> SheetsOut:
    """D8: hojas guardadas desde `accepted_at`, sin trazos. 404 si no hay acceso."""
    response.headers["Cache-Control"] = "no-store"
    try:
        page = await _gateway(request).teacher_student_sheets(
            teacher.tutor_id, student_id, offset, limit
        )
    except GatewayError as exc:
        log_event(logger, "teacher.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if page is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    return SheetsOut(
        items=[
            SheetItemOut(
                id=i.id,
                label=topic_label(0, i.topic),
                tutor_task=i.topic == ASSIGNMENT_TOPIC,
                correct=i.correct,
                day=i.day,
            )
            for i in page.items
        ],
        has_more=page.has_more,
        next_offset=offset + len(page.items) if page.has_more else None,
    )


@router.get("/students/{student_id}/sheets/{sheet_id}")
async def student_sheet(
    student_id: uuid.UUID,
    sheet_id: uuid.UUID,
    teacher: CurrentTeacher,
    request: Request,
    response: Response,
) -> SheetOut:
    """D8: una hoja. Mismo 404 sin acceso, si no existe o si es anterior al vínculo."""
    response.headers["Cache-Control"] = "no-store"
    try:
        sheet = await _gateway(request).teacher_student_sheet(
            teacher.tutor_id, student_id, sheet_id
        )
    except GatewayError as exc:
        log_event(logger, "teacher.read_failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if sheet is None:
        raise ApiError(404, "not_found", message=_NOT_FOUND)
    task = sheet.topic == ASSIGNMENT_TOPIC
    try:
        strokes = [Stroke.model_validate(s) for s in sheet.strokes]
    except ValueError:
        log_event(logger, "teacher.read_failed", code="bad_strokes")
        raise ApiError(503, "service_unavailable") from None
    return SheetOut(
        id=sheet.id,
        label=topic_label(0, sheet.topic),
        tutor_task=task,
        correct=sheet.correct,
        day=sheet.day,
        # Defensa en profundidad: la base ya guarda "Tarea del tutor", aquí se vuelve a imponer.
        statement="Tarea del tutor" if task else sheet.statement,
        child_answer=sheet.child_answer,
        correct_answer=sheet.correct_answer,
        strokes=strokes,
    )
