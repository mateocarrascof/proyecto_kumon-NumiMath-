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
class ConsentSummary:
    """Estado del consentimiento de un tutor (solo lectura; sin datos del niño)."""

    last_event: str | None  # 'grant' | 'revoke' | None si nunca aceptó
    occurred_at: datetime | None  # fecha-hora UTC de ese evento: la constancia
    profiles_total: int
    profiles_active: int  # los que aún se pueden usar (0 tras revocar)
    purge_after_days: int | None  # plazo provisional para borrar los bloqueados por revocación
    purge_at: datetime | None


@dataclass(frozen=True)
class AttemptRow:
    """Un intento de práctica: solo tema, resultado y hora (nunca la respuesta del niño)."""

    topic: str
    correct: bool
    answered_at: datetime
    # Segundos que tardó (lo mide el servidor); None si no se pudo medir.
    duration_s: int | None = None


@dataclass(frozen=True)
class DiagnosticItem:
    """Un ejercicio del diagnóstico ya corregido por el servidor (nunca la respuesta del niño)."""

    exercise_id: uuid.UUID
    exercise: str
    correct: bool
    level: int


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
class TeacherRow:
    """Docente para la lista del administrador (cuenta de adulto; nunca datos de niños)."""

    id: uuid.UUID
    name: str
    email: str
    link_code: str


@dataclass(frozen=True)
class TeacherProfile:
    """Perfil del docente: solo su nombre y su código de vínculo (nunca datos de niños)."""

    name: str
    link_code: str


@dataclass(frozen=True)
class LinkLookup:
    """Resultado de buscar un docente por su código (solo su nombre y el texto legal vigente)."""

    status: str  # ok | not_found | locked | already_linked | student_not_found | no_terms
    teacher_id: uuid.UUID | None = None
    name: str = ""
    terms_id: uuid.UUID | None = None
    terms_version: str = ""
    terms_sha256: str = ""
    retry_after: int = 0


@dataclass(frozen=True)
class LinkedTeacher:
    """Docente vinculado a un perfil: nombre actual y el mostrado al aceptar (nunca el correo)."""

    teacher_id: uuid.UUID
    name: str
    shown_name: str
    accepted_at: datetime


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

    async def save_diagnostic(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        topic: str,
        level: int,
        items: list[DiagnosticItem],
    ) -> str:
        """Guarda los 6 intentos del diagnóstico y el nivel de entrada, en una transacción.

        Devuelve `ok`, `not_available` (la habilidad ya tiene intentos o progreso) o
        `student_not_found`.
        """
        ...

    async def list_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, limit: int
    ) -> list[AttemptRow]:
        """Últimos intentos de PRÁCTICA del perfil (sin el diagnóstico), del más reciente al más
        antiguo. Acotado al tutor."""
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
        """Enunciados de los últimos intentos de PRÁCTICA del perfil en un tema, del más nuevo al
        más viejo. Acotado al tutor. Sirve para no repetir ejercicios dentro del bloque en curso
        (el diagnóstico no es parte del bloque)."""
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

    async def consent_summary(self, tutor_id: uuid.UUID) -> ConsentSummary:
        """Último evento de consentimiento con su fecha y cuántos perfiles siguen activos."""
        ...

    async def archive_consent_evidence(
        self, tutor_id: uuid.UUID, tutor_ref: str, key_version: int
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

    async def admin_create_teacher(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID, name: str, link_code: str
    ) -> str:
        """Registra al docente y deja constancia en una transacción. `ok` o `code_taken`.

        La base comprueba que `admin_id` es administrador y que la cuenta ya tiene el rol docente.
        """
        ...

    async def admin_list_teachers(self) -> list[TeacherRow]:
        """Docentes en orden alfabético, con correo y código. Solo lectura."""
        ...

    async def teacher_profile(self, teacher_id: uuid.UUID) -> TeacherProfile | None:
        """Perfil del docente, o `None` si la cuenta no es de docente o ya no tiene perfil."""
        ...

    async def admin_get_teacher(self, teacher_id: uuid.UUID) -> TeacherRow | None:
        """Un docente con su correo, o `None` si no existe."""
        ...

    async def admin_update_teacher(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID, name: str, email_changed: bool
    ) -> str:
        """Cambia el nombre y deja constancia. `ok`, `unchanged` o `not_found`."""
        ...

    async def admin_record_teacher_deleted(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> None:
        """Constancia de la baja de un docente (solo ids)."""
        ...

    async def admin_email_in_use(self, email: str, except_id: uuid.UUID) -> bool:
        """¿Otra cuenta ya usa este correo?"""
        ...

    async def admin_revoke_teacher_sessions(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> int:
        """Cierra todas las sesiones del docente (invalida sus tokens de refresco)."""
        ...

    async def teacher_link_lookup(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, code: str
    ) -> LinkLookup:
        """Busca al docente por su código y cuenta los fallos (5 y 15 minutos de bloqueo)."""
        ...

    async def create_teacher_link(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        teacher_id: uuid.UUID,
        teacher_name: str,
        terms_version_id: uuid.UUID,
    ) -> str:
        """Crea el vínculo. `ok`, `already_linked`, `student_not_found`, `teacher_not_found`,
        `name_changed`, `terms_outdated` o `consent_required`."""
        ...

    async def list_student_teachers(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> list[LinkedTeacher] | None:
        """Docentes vinculados al perfil, o `None` si el perfil no es del tutor."""
        ...

    async def remove_teacher_link(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> str:
        """Quita el vínculo (no toca datos del niño). `ok` o `not_found`."""
        ...
