"""Dobles de prueba (no se distribuyen con el servidor)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.db.gateway import GatewayError


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

    # consumo
    usage_error: Exception | None = None
    usage_override: str | None = None
    student_used: dict[uuid.UUID, int] = field(default_factory=dict)
    tutor_used: dict[uuid.UUID, int] = field(default_factory=dict)
    usage_calls: list[tuple[uuid.UUID, uuid.UUID, int, int, int]] = field(default_factory=list)

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        self.calls.append((tutor_id, student_id))
        if self.error is not None:
            raise self.error
        return self.outcomes.get((tutor_id, student_id), self.default)

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

    async def assert_read_committed(self) -> None:
        if self.error is not None:
            raise self.error

    async def aclose(self) -> None:
        self.closed = True


def gateway_down() -> FakeGateway:
    return FakeGateway(error=GatewayError("transport"))
