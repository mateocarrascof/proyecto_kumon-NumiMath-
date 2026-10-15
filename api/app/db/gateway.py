"""Interfaz de acceso a la base. El resto del servidor depende de ESTA interfaz, no de Supabase.

Implementaciones: `SupabaseGateway` (producción y desarrollo) y un doble en memoria en las
pruebas. Cambiar de transporte (p. ej. conexión directa a PostgreSQL) no toca el resto.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


class GatewayError(Exception):
    """Fallo de infraestructura (red, timeout, respuesta inesperada). El llamador FALLA CERRADO."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class AttemptRow:
    """Un intento de práctica: solo tema, resultado y hora (nunca la respuesta del niño)."""

    topic: str
    correct: bool
    answered_at: datetime


class Gateway(Protocol):
    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        """Comprobaciones 2 y 3 del ADR 0001 en una transacción.

        Devuelve `ok`, `student_not_found`, `student_blocked` o `consent_required`.
        """
        ...

    async def consume_usage(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        cost: int,
        student_limit: int,
        tutor_limit: int,
    ) -> str:
        """Consume cuota de forma atómica. Devuelve `ok`, `student_limit` o `tutor_limit`.

        Si se superaría un límite, NO se registra nada.
        """
        ...

    async def get_student_grade(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> int | None:
        """Curso (1 a 4) del perfil, leído de la base. `None` si el perfil no es del tutor.

        Es lo ÚNICO que se lee del perfil: nunca el apodo.
        """
        ...

    async def touch_student_activity(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> bool:
        """Marca actividad del perfil (como máximo una escritura al día). Mejor esfuerzo."""
        ...

    async def record_attempt(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        exercise_id: uuid.UUID,
        topic: str,
        exercise: str,
        correct: bool,
    ) -> str:
        """Registra el intento de un ejercicio. Devuelve `ok`, `duplicate` o `student_not_found`.

        Cada ejercicio se registra UNA sola vez por perfil (restricción única en la base).
        """
        ...

    async def list_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, limit: int
    ) -> list[AttemptRow]:
        """Últimos intentos del perfil, del más reciente al más antiguo. Acotado al tutor."""
        ...

    async def assert_read_committed(self) -> None:
        """Falla si la base no atiende bajo READ COMMITTED (regla fija del ADR 0001, 2.3)."""
        ...

    async def aclose(self) -> None: ...
