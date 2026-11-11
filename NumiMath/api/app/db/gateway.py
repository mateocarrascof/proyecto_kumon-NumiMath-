"""Interfaz de acceso a la base. El resto del servidor depende de ESTA interfaz, no de Supabase.

Implementaciones: `SupabaseGateway` (producción y desarrollo) y un doble en memoria en las
pruebas. Cambiar de transporte (p. ej. conexión directa a PostgreSQL) no toca el resto.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from app.exercises.levels import SkillProgress
from app.streaks import DailyStreakRow


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
    # Segundos que tardó (lo mide el servidor); None si no se pudo medir.
    duration_s: int | None = None


@dataclass(frozen=True)
class AssignmentRow:
    """Ejercicio propio del tutor. `answer` solo se expone en la vista del tutor."""

    id: uuid.UUID
    text: str
    answer: int
    created_at: datetime
    answered_at: datetime | None
    correct: bool | None


@dataclass(frozen=True)
class AssignmentAnswer:
    """Resultado de responder una tarea: `ok`, `duplicate` o `not_found`."""

    status: str
    correct: bool = False
    answer: int = 0


@dataclass(frozen=True)
class PinState:
    """Estado del PIN del tutor. `pin_hash` es argon2id; nunca sale del servidor."""

    pin_hash: str
    locked_until: datetime | None
    failed_attempts: int


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
        local_day: date | None = None,
        level: int = 1,
        duration_s: int | None = None,
    ) -> str:
        """Registra el intento de un ejercicio. Devuelve `ok`, `duplicate` o `student_not_found`.

        `level` es el nivel de dificultad (1 a 3) con que se emitió el ejercicio.

        Cada ejercicio se registra UNA sola vez por perfil (restricción única en la base).
        Si el intento es nuevo y `local_day` es válida, la base actualiza la racha diaria en la
        misma transacción.
        """
        ...

    async def get_daily_streak(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> DailyStreakRow | None:
        """Racha diaria guardada del perfil (sin ajustar a hoy). Acotado al tutor."""
        ...

    async def list_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, limit: int
    ) -> list[AttemptRow]:
        """Últimos intentos del perfil, del más reciente al más antiguo. Acotado al tutor."""
        ...

    async def list_skill_progress(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> dict[str, SkillProgress]:
        """Progreso por habilidad del perfil (nivel, bloque en curso, dominada). Acotado al
        tutor. Una habilidad sin fila no se ha practicado (nivel 1, bloque vacío)."""
        ...

    async def list_recent_exercises(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, topic: str, limit: int
    ) -> list[str]:
        """Enunciados de los últimos intentos del perfil en un tema, del más nuevo al más viejo.
        Acotado al tutor. Sirve para no repetir ejercicios dentro del bloque en curso."""
        ...

    async def create_assignment(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, text: str, answer: int
    ) -> str:
        """Crea una tarea ya filtrada. `ok`, `student_not_found` o `limit` (20 pendientes)."""
        ...

    async def delete_assignment(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, assignment_id: uuid.UUID
    ) -> str:
        """Borra una tarea PENDIENTE. `ok` o `not_found`."""
        ...

    async def list_assignments(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, *, pending_only: bool, limit: int
    ) -> list[AssignmentRow]:
        """Tareas del perfil: pendientes primero (de la más vieja a la más nueva) y luego
        respondidas (de la más reciente a la más vieja). Acotado al tutor."""
        ...

    async def answer_assignment(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        assignment_id: uuid.UUID,
        answer: int,
        local_day: date | None,
        duration_s: int | None = None,
    ) -> AssignmentAnswer:
        """Responde una tarea y registra el intento (suma a progreso y racha). Una transacción."""
        ...

    async def delete_student(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        """Borra el perfil (y en cascada sus datos). `ok` o `not_found`."""
        ...

    async def revoke_consent(self, tutor_id: uuid.UUID) -> str:
        """Registra una revocación con las versiones del último consentimiento.

        Bloquea los perfiles del tutor.

        Devuelve `ok`, `already_revoked` o `no_consent`. La constancia lleva la fecha-hora
        del servidor.
        """
        ...

    async def archive_consent_evidence(
        self, tutor_id: uuid.UUID, tutor_ref: str, email_ref: str, key_version: int
    ) -> int:
        """Archiva la evidencia mínima del consentimiento. Devuelve las filas NUEVAS."""
        ...

    async def consent_evidence_complete(self, tutor_id: uuid.UUID) -> bool:
        """¿Cada consentimiento del tutor ya tiene su evidencia archivada? (ADR 0001, paso 3).

        Se comprueba por consentimiento, no por la huella: sirve aunque la clave haya cambiado.
        """
        ...

    async def purge_auth_audit(self, tutor_id: uuid.UUID, email: str | None) -> int:
        """Borra de Auth el registro de auditoría del tutor (correo, IP). Devuelve las filas."""
        ...

    async def tutor_exists(self, tutor_id: uuid.UUID) -> bool: ...

    async def get_pin_state(self, tutor_id: uuid.UUID) -> PinState | None:
        """PIN del tutor (hash y bloqueo), o `None` si aún no lo crea."""
        ...

    async def set_pin(self, tutor_id: uuid.UUID, pin_hash: str) -> None:
        """Crea o reemplaza el PIN (reinicia intentos y bloqueo)."""
        ...

    async def register_pin_attempt(
        self, tutor_id: uuid.UUID, success: bool
    ) -> tuple[datetime | None, int]:
        """Registra una verificación. Devuelve (bloqueado hasta, fallos seguidos)."""
        ...

    async def assert_read_committed(self) -> None:
        """Falla si la base no atiende bajo READ COMMITTED (regla fija del ADR 0001, 2.3)."""
        ...

    async def aclose(self) -> None: ...
