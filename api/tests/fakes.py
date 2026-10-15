"""Dobles de prueba (no se distribuyen con el servidor)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.db.gateway import AttemptRow, GatewayError


@dataclass
class FakeGateway:
    """Gateway en memoria: respuestas por (tutor, perfil), con inyección de fallos.

    El consumo imita a la base: contadores por perfil y por tutor; el del tutor NO se reinicia
    al cambiar de perfil (ni al "borrar" uno).
    """

    outcomes: dict[tuple[uuid.UUID, uuid.UUID], str] = field(default_factory=dict)
    default: str = "student_not_found"
    error: Exception | None = None
    calls: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)
    closed: bool = False

    # curso del perfil y actividad
    grades: dict[tuple[uuid.UUID, uuid.UUID], int] = field(default_factory=dict)
    grade_error: Exception | None = None
    touches: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)
    touch_error: Exception | None = None

    # respuestas sucesivas de authorize_student_use (se consumen en orden; luego rige `default`)
    sequence: list[str] = field(default_factory=list)
    error_after: int | None = None  # a partir de la llamada N (1-based) lanza `error`

    # intentos de práctica
    attempts: dict[tuple[uuid.UUID, uuid.UUID], tuple[str, str, bool]] = field(default_factory=dict)
    record_error: Exception | None = None
    attempt_rows: dict[uuid.UUID, list[AttemptRow]] = field(default_factory=dict)

    # consumo
    usage_error: Exception | None = None
    usage_override: str | None = None
    student_used: dict[uuid.UUID, int] = field(default_factory=dict)
    tutor_used: dict[uuid.UUID, int] = field(default_factory=dict)
    usage_calls: list[tuple[uuid.UUID, uuid.UUID, int, int, int]] = field(default_factory=list)

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        self.calls.append((tutor_id, student_id))
        if self.error is not None and (
            self.error_after is None or len(self.calls) >= self.error_after
        ):
            raise self.error
        if self.sequence:
            return self.sequence.pop(0)
        return self.outcomes.get((tutor_id, student_id), self.default)

    async def get_student_grade(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> int | None:
        if self.grade_error is not None:
            raise self.grade_error
        return self.grades.get((tutor_id, student_id))

    async def touch_student_activity(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> bool:
        self.touches.append((tutor_id, student_id))
        if self.touch_error is not None:
            raise self.touch_error
        return True

    async def consume_usage(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        cost: int,
        student_limit: int,
        tutor_limit: int,
    ) -> str:
        self.usage_calls.append((tutor_id, student_id, cost, student_limit, tutor_limit))
        if self.usage_error is not None:
            raise self.usage_error
        if self.usage_override is not None:
            return self.usage_override
        if self.student_used.get(student_id, 0) + cost > student_limit:
            return "student_limit"
        if self.tutor_used.get(tutor_id, 0) + cost > tutor_limit:
            return "tutor_limit"
        self.student_used[student_id] = self.student_used.get(student_id, 0) + cost
        self.tutor_used[tutor_id] = self.tutor_used.get(tutor_id, 0) + cost
        return "ok"

    async def record_attempt(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        exercise_id: uuid.UUID,
        topic: str,
        exercise: str,
        correct: bool,
    ) -> str:
        if self.record_error is not None:
            raise self.record_error
        if (tutor_id, student_id) not in self.grades:
            return "student_not_found"
        key = (student_id, exercise_id)
        if key in self.attempts:
            return "duplicate"
        self.attempts[key] = (topic, exercise, correct)
        return "ok"

    async def list_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, limit: int
    ) -> list[AttemptRow]:
        if self.record_error is not None:
            raise self.record_error
        if (tutor_id, student_id) not in self.grades:
            return []
        rows = self.attempt_rows.get(student_id, [])
        return sorted(rows, key=lambda r: r.answered_at, reverse=True)[:limit]

    async def assert_read_committed(self) -> None:
        if self.error is not None:
            raise self.error

    async def aclose(self) -> None:
        self.closed = True


def gateway_down() -> FakeGateway:
    return FakeGateway(error=GatewayError("transport"))
