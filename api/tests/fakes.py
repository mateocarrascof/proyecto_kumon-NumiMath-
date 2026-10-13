"""Dobles de prueba (no se distribuyen con el servidor)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.db.gateway import GatewayError


@dataclass
class FakeGateway:
    """Gateway en memoria: respuestas por (tutor, perfil), con inyección de fallos."""

    outcomes: dict[tuple[uuid.UUID, uuid.UUID], str] = field(default_factory=dict)
    default: str = "student_not_found"
    error: Exception | None = None
    calls: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)
    closed: bool = False

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        self.calls.append((tutor_id, student_id))
        if self.error is not None:
            raise self.error
        return self.outcomes.get((tutor_id, student_id), self.default)

    async def assert_read_committed(self) -> None:
        if self.error is not None:
            raise self.error

    async def aclose(self) -> None:
        self.closed = True


def gateway_down() -> FakeGateway:
    return FakeGateway(error=GatewayError("transport"))
