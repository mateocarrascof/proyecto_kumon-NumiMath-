"""Progreso de práctica de un perfil (lectura para el tutor).

Se calcula en el servidor a partir de `student_attempts`: aciertos por tema, últimos intentos y
racha de aciertos. La racha diaria ("días seguidos") sale de `student_daily_streaks`, ajustada a la
fecha local que manda el dispositivo. Solo se leen tema, resultado y hora; el apodo no interviene.

CU-A23 (evolución): `weeks` agrupa los mismos intentos de práctica en las últimas 8 semanas, con
la misma función que el informe del tutor (`app/weekly.py`). El diagnóstico inicial no cuenta:
`list_attempts` solo lee `activity = 'practice'`.
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.ai.topics import topic_label
from app.db.gateway import AttemptRow, Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.streaks import effective_streak, parse_local_day, utc_today
from app.weekly import WeekOut, weekly

router = APIRouter(prefix="/v1/students", tags=["progress"])
logger = get_logger("mathtutor.progress")

WINDOW = 500  # intentos considerados
RECENT = 10  # intentos recientes que se muestran


class TopicProgress(BaseModel):
    topic: str
    label: str
    total: int
    correct: int


class RecentAttempt(BaseModel):
    topic: str
    label: str
    correct: bool
    answered_at: datetime


class ProgressOut(BaseModel):
    total: int
    correct: int
    streak: int
    daily_streak: int = 0
    practiced_today: bool = False
    by_topic: list[TopicProgress]
    recent: list[RecentAttempt]
    # Evolución (CU-A23): 8 semanas que terminan hoy, de la más antigua a la actual, con vacías.
    weeks: list[WeekOut] = []


def summarize(attempts: list[AttemptRow], grade: int) -> ProgressOut:
    """`attempts` viene del más reciente al más antiguo."""

    def label(topic: str) -> str:
        return topic_label(grade, topic)

    streak = 0
    for attempt in attempts:
        if not attempt.correct:
            break
        streak += 1

    per_topic: dict[str, list[int]] = {}
    for attempt in attempts:
        total_correct = per_topic.setdefault(attempt.topic, [0, 0])
        total_correct[0] += 1
        total_correct[1] += 1 if attempt.correct else 0

    return ProgressOut(
        total=len(attempts),
        correct=sum(1 for a in attempts if a.correct),
        streak=streak,
        by_topic=[
            TopicProgress(topic=t, label=label(t), total=v[0], correct=v[1])
            for t, v in sorted(per_topic.items(), key=lambda item: -item[1][0])
        ],
        recent=[
            RecentAttempt(
                topic=a.topic, label=label(a.topic), correct=a.correct, answered_at=a.answered_at
            )
            for a in attempts[:RECENT]
        ],
    )


@router.get("/{student_id}/progress")
async def get_progress(
    student: AuthorizedStudentDep,
    request: Request,
    today: date | None = None,
) -> ProgressOut:
    gateway: Gateway = request.app.state.gateway
    try:
        grade = await gateway.get_student_grade(student.tutor_id, student.student_id)
        if grade is None:
            raise ApiError(403, "forbidden")
        attempts = await gateway.list_attempts(student.tutor_id, student.student_id, WINDOW)
        streak_row = await gateway.get_daily_streak(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "progress.denied", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    local_today = parse_local_day(today) or utc_today()
    daily, practiced_today = effective_streak(streak_row, local_today)
    return summarize(attempts, grade).model_copy(
        update={
            "daily_streak": daily,
            "practiced_today": practiced_today,
            "weeks": weekly(attempts, local_today),
        }
    )
