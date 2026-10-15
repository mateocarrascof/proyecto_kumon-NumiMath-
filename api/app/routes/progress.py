"""Progreso de práctica de un perfil (lectura para el tutor).

Se calcula en el servidor a partir de `student_attempts`: aciertos por tema, últimos intentos y
racha. Solo se leen tema, resultado y hora; el apodo del perfil no interviene.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.ai.topics import get_topic
from app.db.gateway import AttemptRow, Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.logging import get_logger, log_event

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
    by_topic: list[TopicProgress]
    recent: list[RecentAttempt]


def summarize(attempts: list[AttemptRow], grade: int) -> ProgressOut:
    """`attempts` viene del más reciente al más antiguo."""

    def label(topic: str) -> str:
        found = get_topic(grade, topic)
        return found.label if found else topic

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
async def get_progress(student: AuthorizedStudentDep, request: Request) -> ProgressOut:
    gateway: Gateway = request.app.state.gateway
    try:
        grade = await gateway.get_student_grade(student.tutor_id, student.student_id)
        if grade is None:
            raise ApiError(403, "forbidden")
        attempts = await gateway.list_attempts(student.tutor_id, student.student_id, WINDOW)
    except GatewayError as exc:
        log_event(logger, "progress.denied", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    return summarize(attempts, grade)
