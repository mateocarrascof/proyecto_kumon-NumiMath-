"""Dobles de prueba (no se distribuyen con el servidor)."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from app.db.gateway import (
    AssignmentAnswer,
    AssignmentRow,
    AttemptRow,
    ConsentSummary,
    DiagnosticItem,
    GatewayError,
    PinState,
)
from app.exercises.levels import SkillProgress, apply_answer
from app.streaks import DailyStreakRow, parse_local_day

# Mismo patrón que record_attempt en la base: solo los códigos de habilidad tienen progreso.
SKILL_CODE = re.compile(r"[1-4]-[0-9]{2}")


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
    local_days: list[date | None] = field(default_factory=list)
    # nivel de cada intento registrado (en orden) y fallo de la lectura de niveles
    levels: list[tuple[uuid.UUID, str, int, bool]] = field(default_factory=list)
    levels_error: Exception | None = None
    # progreso por habilidad (imita student_skill_progress) y enunciados registrados en orden
    progress: dict[uuid.UUID, dict[str, SkillProgress]] = field(default_factory=dict)
    exercises: list[tuple[uuid.UUID, str, str]] = field(default_factory=list)
    durations: list[int | None] = field(default_factory=list)
    # diagnósticos guardados: (perfil, tema, nivel de entrada, ejercicios) y fallo al guardar
    diagnostics: list[tuple[uuid.UUID, str, int, list[DiagnosticItem]]] = field(
        default_factory=list
    )
    diagnostic_error: Exception | None = None

    # ejercicios propios del tutor: id -> (tutor, perfil, fila)
    assignments: dict[uuid.UUID, tuple[uuid.UUID, uuid.UUID, AssignmentRow]] = field(
        default_factory=dict
    )
    assignment_error: Exception | None = None

    # borrado de perfiles
    deleted: list[uuid.UUID] = field(default_factory=list)
    delete_error: Exception | None = None

    # PIN del tutor (imita tutor_pins)
    pins: dict[uuid.UUID, PinState] = field(default_factory=dict)
    pin_error: Exception | None = None

    # racha diaria (imita record_attempt de la base)
    streaks: dict[uuid.UUID, DailyStreakRow] = field(default_factory=dict)
    streak_error: Exception | None = None

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
        local_day: date | None = None,
        level: int = 1,
        duration_s: int | None = None,
    ) -> str:
        if self.record_error is not None:
            raise self.record_error
        if (tutor_id, student_id) not in self.grades:
            return "student_not_found"
        key = (student_id, exercise_id)
        if key in self.attempts:
            return "duplicate"
        self.attempts[key] = (topic, exercise, correct)
        self.local_days.append(local_day)
        self.levels.append((student_id, topic, level, correct))
        self.exercises.append((student_id, topic, exercise))
        if SKILL_CODE.fullmatch(topic):
            skills = self.progress.setdefault(student_id, {})
            skills[topic] = apply_answer(skills.get(topic, SkillProgress()), level, correct)
        self.durations.append(duration_s)
        day = parse_local_day(local_day)
        if day is not None:
            row = self.streaks.get(student_id)
            if row is None:
                self.streaks[student_id] = DailyStreakRow(1, day)
            elif day > row.last_day:
                length = row.current_len + 1 if day == row.last_day + timedelta(days=1) else 1
                self.streaks[student_id] = DailyStreakRow(length, day)
        return "ok"

    async def save_diagnostic(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        topic: str,
        level: int,
        items: list[DiagnosticItem],
    ) -> str:
        # Imita save_diagnostic: solo si la habilidad no tiene intentos ni progreso; guarda el
        # nivel de entrada con bloque vacío y NO toca racha, bloque ni intentos de práctica.
        if self.diagnostic_error is not None:
            raise self.diagnostic_error
        if (tutor_id, student_id) not in self.grades:
            return "student_not_found"
        practiced = any(s == student_id and t == topic for s, t, _ in self.exercises)
        diagnosed = any(s == student_id and t == topic for s, t, _, _ in self.diagnostics)
        if practiced or diagnosed or topic in self.progress.get(student_id, {}):
            return "not_available"
        self.diagnostics.append((student_id, topic, level, list(items)))
        self.progress.setdefault(student_id, {})[topic] = SkillProgress(level)
        return "ok"

    async def get_daily_streak(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> DailyStreakRow | None:
        if self.streak_error is not None:
            raise self.streak_error
        if (tutor_id, student_id) not in self.grades:
            return None
        return self.streaks.get(student_id)

    async def list_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, limit: int
    ) -> list[AttemptRow]:
        if self.record_error is not None:
            raise self.record_error
        if (tutor_id, student_id) not in self.grades:
            return []
        rows = self.attempt_rows.get(student_id, [])
        return sorted(rows, key=lambda r: r.answered_at, reverse=True)[:limit]

    async def list_skill_progress(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> dict[str, SkillProgress]:
        if self.levels_error is not None:
            raise self.levels_error
        if (tutor_id, student_id) not in self.grades:
            return {}
        return dict(self.progress.get(student_id, {}))

    async def list_recent_exercises(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, topic: str, limit: int
    ) -> list[str]:
        if self.levels_error is not None:
            raise self.levels_error
        if (tutor_id, student_id) not in self.grades:
            return []
        texts = [text for s, t, text in reversed(self.exercises) if s == student_id and t == topic]
        return texts[:limit]

    async def create_assignment(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, text: str, answer: int
    ) -> str:
        if self.assignment_error is not None:
            raise self.assignment_error
        if (tutor_id, student_id) not in self.grades:
            return "student_not_found"
        pending = [
            r for _, s, r in self.assignments.values() if s == student_id and r.answered_at is None
        ]
        if len(pending) >= 20:
            return "limit"
        row = AssignmentRow(uuid.uuid4(), text, answer, datetime.now(UTC), None, None)
        self.assignments[row.id] = (tutor_id, student_id, row)
        return "ok"

    async def delete_assignment(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, assignment_id: uuid.UUID
    ) -> str:
        if self.assignment_error is not None:
            raise self.assignment_error
        found = self.assignments.get(assignment_id)
        if found is None or found[:2] != (tutor_id, student_id) or found[2].answered_at:
            return "not_found"
        del self.assignments[assignment_id]
        return "ok"

    async def list_assignments(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, *, pending_only: bool, limit: int
    ) -> list[AssignmentRow]:
        if self.assignment_error is not None:
            raise self.assignment_error
        rows = [r for t, s, r in self.assignments.values() if (t, s) == (tutor_id, student_id)]
        pending = sorted((r for r in rows if r.answered_at is None), key=lambda r: r.created_at)
        done = sorted(
            (r for r in rows if r.answered_at is not None),
            key=lambda r: r.answered_at or r.created_at,
            reverse=True,
        )
        return (pending if pending_only else pending + done)[:limit]

    async def answer_assignment(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        assignment_id: uuid.UUID,
        answer: int,
        local_day: date | None,
        duration_s: int | None = None,
    ) -> AssignmentAnswer:
        if self.assignment_error is not None:
            raise self.assignment_error
        found = self.assignments.get(assignment_id)
        if found is None or found[:2] != (tutor_id, student_id):
            return AssignmentAnswer("not_found")
        row = found[2]
        if row.answered_at is not None:
            return AssignmentAnswer("duplicate")
        correct = answer == row.answer
        done = AssignmentRow(
            row.id, row.text, row.answer, row.created_at, datetime.now(UTC), correct
        )
        self.assignments[row.id] = (tutor_id, student_id, done)
        await self.record_attempt(
            tutor_id, student_id, row.id, "tarea_tutor", row.text, correct, local_day, 1, duration_s
        )
        return AssignmentAnswer("ok", correct, row.answer)

    async def delete_student(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        if self.delete_error is not None:
            raise self.delete_error
        if (tutor_id, student_id) not in self.grades:
            return "not_found"
        del self.grades[(tutor_id, student_id)]
        self.deleted.append(student_id)
        return "ok"

    async def get_pin_state(self, tutor_id: uuid.UUID) -> PinState | None:
        if self.pin_error is not None:
            raise self.pin_error
        return self.pins.get(tutor_id)

    async def set_pin(self, tutor_id: uuid.UUID, pin_hash: str) -> None:
        if self.pin_error is not None:
            raise self.pin_error
        self.pins[tutor_id] = PinState(pin_hash, None, 0)

    async def register_pin_attempt(
        self, tutor_id: uuid.UUID, success: bool
    ) -> tuple[datetime | None, int]:
        if self.pin_error is not None:
            raise self.pin_error
        state = self.pins[tutor_id]
        now = datetime.now(UTC)
        if state.locked_until is not None and state.locked_until > now:
            return state.locked_until, state.failed_attempts
        if success:
            self.pins[tutor_id] = PinState(state.pin_hash, None, 0)
            return None, 0
        attempts = state.failed_attempts + 1
        if attempts >= 5:
            until = now + timedelta(minutes=15)
            self.pins[tutor_id] = PinState(state.pin_hash, until, 0)
            return until, 0
        self.pins[tutor_id] = PinState(state.pin_hash, None, attempts)
        return None, attempts

    async def assert_read_committed(self) -> None:
        if self.error is not None:
            raise self.error

    async def aclose(self) -> None:
        self.closed = True


def gateway_down() -> FakeGateway:
    return FakeGateway(error=GatewayError("transport"))


@dataclass
class AccountFakeGateway(FakeGateway):
    """Gateway con el flujo de borrado de cuenta: registra el ORDEN de las llamadas."""

    log: list[str] = field(default_factory=list)
    existing: set[uuid.UUID] = field(default_factory=set)
    revoke_result: str = "ok"
    archive_error: Exception | None = None
    complete: bool = True
    purge_error: Exception | None = None
    revoke_error: Exception | None = None
    exists_error_on_call: int | None = None
    exists_calls: int = 0
    summary_error: Exception | None = None
    summary: ConsentSummary = field(
        default_factory=lambda: ConsentSummary(
            "revoke",
            datetime(2026, 11, 11, 15, 30, tzinfo=UTC),
            2,
            0,
            30,
            datetime(2026, 12, 11, 15, 30, tzinfo=UTC),
        )
    )
    revoked_for: list[uuid.UUID] = field(default_factory=list)
    purged: list[tuple[uuid.UUID, str | None]] = field(default_factory=list)
    archived: list[tuple[uuid.UUID, str, int]] = field(default_factory=list)

    async def tutor_exists(self, tutor_id: uuid.UUID) -> bool:
        self.log.append("tutor_exists")
        self.exists_calls += 1
        if self.exists_error_on_call == self.exists_calls:
            raise GatewayError("transport")
        return tutor_id in self.existing

    async def revoke_consent(self, tutor_id: uuid.UUID) -> str:
        self.log.append("revoke_consent")
        self.revoked_for.append(tutor_id)
        if self.revoke_error is not None:
            raise self.revoke_error
        return self.revoke_result

    async def consent_summary(self, tutor_id: uuid.UUID) -> ConsentSummary:
        self.log.append("summary")
        if self.summary_error is not None:
            raise self.summary_error
        return self.summary

    async def archive_consent_evidence(
        self, tutor_id: uuid.UUID, tutor_ref: str, key_version: int
    ) -> int:
        self.log.append("archive")
        if self.archive_error is not None:
            raise self.archive_error
        self.archived.append((tutor_id, tutor_ref, key_version))
        return 0

    async def consent_evidence_complete(self, tutor_id: uuid.UUID) -> bool:
        self.log.append("complete")
        return self.complete

    async def purge_auth_audit(self, tutor_id: uuid.UUID, email: str | None) -> int:
        self.log.append("purge_audit")
        self.purged.append((tutor_id, email))
        if self.purge_error is not None:
            raise self.purge_error
        return 0


@dataclass
class FakeAuthAdmin:
    """Administración de Auth en memoria: comparte el registro de llamadas con el gateway."""

    gateway: AccountFakeGateway
    emails: dict[uuid.UUID, str] = field(default_factory=dict)
    fail_on: set[str] = field(default_factory=set)
    banned: set[uuid.UUID] = field(default_factory=set)
    deleted: list[uuid.UUID] = field(default_factory=list)

    def _maybe_fail(self, name: str) -> None:
        from app.auth.admin import AuthAdminError

        if name in self.fail_on:
            raise AuthAdminError("transport")

    async def get_email(self, user_id: uuid.UUID) -> str | None:
        self.gateway.log.append("get_email")
        self._maybe_fail("get_email")
        return self.emails.get(user_id)

    async def ban(self, user_id: uuid.UUID) -> None:
        self.gateway.log.append("ban")
        self._maybe_fail("ban")
        self.banned.add(user_id)

    async def unban(self, user_id: uuid.UUID) -> None:
        self.gateway.log.append("unban")
        self._maybe_fail("unban")
        self.banned.discard(user_id)

    async def delete(self, user_id: uuid.UUID) -> str:
        self.gateway.log.append("delete")
        self._maybe_fail("delete")
        self.deleted.append(user_id)
        if user_id in self.gateway.existing:
            self.gateway.existing.discard(user_id)  # la cascada borra al tutor
            return "deleted"
        return "not_found"

    async def aclose(self) -> None:
        return None
