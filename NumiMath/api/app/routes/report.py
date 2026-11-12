"""Informe del perfil para el ADULTO: resumen, semanas, temas y feedback por reglas.

Zona del tutor: pide el token parental (PIN verificado). Se calcula al vuelo con los últimos
intentos (`progress.WINDOW`); no guarda datos nuevos.
"Hoy" es la fecha local del dispositivo (validada como en la racha); la fecha de cada intento,
UTC. Reglas: docs/SPEC.md ("Informe y feedback para el adulto").
"""

from __future__ import annotations

from datetime import date, timedelta
from statistics import median

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.db.gateway import AttemptRow, Gateway, GatewayError
from app.deps import ParentalStudentDep
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.report_feedback import TopicStat, WeekStat, build_feedback, percent
from app.routes.progress import WINDOW, summarize
from app.streaks import effective_streak, parse_local_day, utc_today
from app.weekly import WeekOut, attempt_day, weekly

router = APIRouter(prefix="/v1/students", tags=["report"])
logger = get_logger("mathtutor.report")

MIN_TIMED = 3  # intentos con tiempo necesarios para mostrar el tiempo típico


def typical_seconds(attempts: list[AttemptRow]) -> int | None:
    """Mediana de los segundos: no la distorsiona un ejercicio que quedó abierto mucho rato."""
    times = [a.duration_s for a in attempts if a.duration_s is not None]
    return int(round(median(times))) if len(times) >= MIN_TIMED else None


class TopicOut(BaseModel):
    topic: str
    label: str
    total: int
    correct: int
    percent: int
    # Tiempo típico (mediana, en segundos). None si hay menos de MIN_TIMED intentos con tiempo.
    median_seconds: int | None = None


class FeedbackOut(BaseModel):
    kind: str
    text: str


class ReportOut(BaseModel):
    total: int
    correct: int
    percent: int
    median_seconds: int | None = None
    daily_streak: int
    practice_days_last_7: int
    weeks: list[WeekOut]
    by_topic: list[TopicOut]
    feedback: list[FeedbackOut]


def practice_days(attempts: list[AttemptRow], today: date) -> int:
    since = today - timedelta(days=6)
    return len({d for d in map(attempt_day, attempts) if since <= d <= today})


@router.get("/{student_id}/report")
async def get_report(
    student: ParentalStudentDep, request: Request, today: date | None = None
) -> ReportOut:
    gateway: Gateway = request.app.state.gateway
    try:
        grade = await gateway.get_student_grade(student.tutor_id, student.student_id)
        if grade is None:
            raise ApiError(403, "forbidden")
        attempts = await gateway.list_attempts(student.tutor_id, student.student_id, WINDOW)
        streak_row = await gateway.get_daily_streak(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "report.denied", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None

    local_today = parse_local_day(today) or utc_today()
    summary = summarize(attempts, grade)
    weeks = weekly(attempts, local_today)
    days = practice_days(attempts, local_today)
    daily, _ = effective_streak(streak_row, local_today)
    feedback = build_feedback(
        summary.total,
        [TopicStat(t.label, t.total, t.correct) for t in summary.by_topic],
        days,
        [WeekStat(w.total, w.correct) for w in weeks],
    )
    return ReportOut(
        total=summary.total,
        correct=summary.correct,
        percent=percent(summary.correct, summary.total),
        median_seconds=typical_seconds(attempts),
        daily_streak=daily,
        practice_days_last_7=days,
        weeks=weeks,
        by_topic=[
            TopicOut(
                topic=t.topic,
                label=t.label,
                total=t.total,
                correct=t.correct,
                percent=percent(t.correct, t.total),
                median_seconds=typical_seconds([a for a in attempts if a.topic == t.topic]),
            )
            for t in summary.by_topic
        ],
        feedback=[FeedbackOut(kind=f.kind, text=f.text) for f in feedback],
    )
