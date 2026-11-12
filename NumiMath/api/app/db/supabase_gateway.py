"""Gateway sobre la API REST de Supabase (PostgREST), con la llave de servidor.

Cada llamada RPC es UNA transacción en READ COMMITTED (el valor por defecto de PostgreSQL
que PostgREST no cambia) y la base además rechaza otro nivel (migración api_support).

La llave de servidor ignora RLS: por eso todo acceso pasa por funciones de la base que
validan la propiedad del perfil (ADR 0001). Nunca se registra la URL, el cuerpo ni la llave.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

import httpx

from app.config import Settings
from app.db.gateway import (
    AssignmentAnswer,
    AssignmentRow,
    AttemptRow,
    ConsentSummary,
    DiagnosticItem,
    GatewayError,
    HistoryItem,
    HistoryPage,
    LinkedTeacher,
    LinkLookup,
    OfflineAttempt,
    PinState,
    SkillState,
    TeacherProfile,
    TeacherProgress,
    TeacherRow,
    TeacherStudent,
    TutorAttempt,
    TutorHistoryPage,
)
from app.exercises.levels import BLOCK_SIZE, MAX_LEVEL, MIN_LEVEL, SkillProgress
from app.streaks import DailyStreakRow

_TIMEOUT = httpx.Timeout(5.0, connect=2.0)


def _duration(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError
    return value


class SupabaseGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._key = settings.supabase_service_role_key.get_secret_value()
        self._base_url = settings.supabase_url.rstrip("/") + "/rest/v1"
        # El cliente HTTP se crea al primer uso: construirlo carga certificados (~0,3 s).
        self._client = client

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers={
                    "apikey": self._key,
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type": "application/json",
                },
                timeout=_TIMEOUT,
            )
        return self._client

    async def _rpc(self, name: str, payload: dict[str, Any]) -> Any:
        if not self._key:
            raise GatewayError("not_configured")
        try:
            response = await self._get_client().post(f"/rpc/{name}", json=payload)
        except httpx.HTTPError:
            # El texto de la excepción puede incluir la URL: no se conserva.
            raise GatewayError("transport") from None
        if response.status_code not in (200, 204):
            raise GatewayError(f"status_{response.status_code}")
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            raise GatewayError("bad_json") from None

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        result = await self._rpc(
            "authorize_student_use",
            {"p_tutor_id": str(tutor_id), "p_student_id": str(student_id)},
        )
        if not isinstance(result, str):
            raise GatewayError("unexpected_result")
        return result

    async def consume_usage(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        cost: int,
        student_limit: int,
        tutor_limit: int,
    ) -> str:
        result = await self._rpc(
            "consume_usage",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_cost": cost,
                "p_student_limit": student_limit,
                "p_tutor_limit": tutor_limit,
            },
        )
        if result not in ("ok", "student_limit", "tutor_limit"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def consume_offline_batch(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, daily_limit: int
    ) -> str:
        result = await self._rpc(
            "consume_offline_batch",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_daily_limit": daily_limit,
            },
        )
        if result not in ("ok", "limit", "student_not_found"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def record_offline_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, attempts: list[OfflineAttempt]
    ) -> dict[uuid.UUID, str] | None:
        result = await self._rpc(
            "record_offline_attempts",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_attempts": [
                    {
                        "exercise_id": str(a.exercise_id),
                        "topic": a.topic,
                        "exercise": a.exercise,
                        "correct": a.correct,
                        "level": a.level,
                        "duration_s": a.duration_s,
                        "answered_at": a.answered_at.isoformat(),
                        "local_day": a.local_day.isoformat() if a.local_day else None,
                    }
                    for a in attempts
                ],
            },
        )
        if result == "student_not_found":
            return None
        if not isinstance(result, list):
            raise GatewayError("unexpected_result")
        statuses: dict[uuid.UUID, str] = {}
        for row in result:
            try:
                key = uuid.UUID(str(row["exercise_id"]))
                status = str(row["status"])
            except (KeyError, TypeError, ValueError):
                raise GatewayError("unexpected_result") from None
            if status not in ("ok", "duplicate"):
                raise GatewayError("unexpected_result")
            statuses[key] = status
        return statuses

    async def get_student_grade(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> int | None:
        if not self._key:
            raise GatewayError("not_configured")
        try:
            response = await self._get_client().get(
                "/students",
                # Solo el curso, y acotado al tutor: la llave de servidor ignora RLS.
                params={
                    "select": "grade",
                    "id": f"eq.{student_id}",
                    "tutor_id": f"eq.{tutor_id}",
                    "limit": "1",
                },
            )
        except httpx.HTTPError:
            raise GatewayError("transport") from None
        if response.status_code != 200:
            raise GatewayError(f"status_{response.status_code}")
        try:
            rows = response.json()
        except ValueError:
            raise GatewayError("bad_json") from None
        if not isinstance(rows, list):
            raise GatewayError("unexpected_result")
        if not rows:
            return None
        grade = rows[0].get("grade") if isinstance(rows[0], dict) else None
        if isinstance(grade, bool) or not isinstance(grade, int) or grade not in (1, 2, 3, 4):
            raise GatewayError("unexpected_result")
        return grade

    async def touch_student_activity(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> bool:
        result = await self._rpc(
            "touch_student_activity",
            {"p_tutor_id": str(tutor_id), "p_student_id": str(student_id)},
        )
        if not isinstance(result, bool):
            raise GatewayError("unexpected_result")
        return result

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
        result = await self._rpc(
            "record_attempt",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_exercise_id": str(exercise_id),
                "p_topic": topic,
                "p_exercise": exercise,
                "p_correct": correct,
                "p_local_day": local_day.isoformat() if local_day else None,
                "p_level": level,
                "p_duration_s": duration_s,
            },
        )
        if result not in ("ok", "duplicate", "student_not_found"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def save_diagnostic(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        topic: str,
        level: int,
        items: list[DiagnosticItem],
    ) -> str:
        result = await self._rpc(
            "save_diagnostic",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_topic": topic,
                "p_level": level,
                "p_attempts": [
                    {
                        "exercise_id": str(item.exercise_id),
                        "exercise": item.exercise,
                        "correct": item.correct,
                        "level": item.level,
                    }
                    for item in items
                ],
            },
        )
        if result not in ("ok", "not_available", "student_not_found"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def list_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, limit: int
    ) -> list[AttemptRow]:
        if not self._key:
            raise GatewayError("not_configured")
        try:
            response = await self._get_client().get(
                "/student_attempts",
                # La llave de servidor ignora RLS: se acota a mano al tutor Y al perfil.
                params={
                    "select": "topic,correct,answered_at,duration_s",
                    "student_id": f"eq.{student_id}",
                    "tutor_id": f"eq.{tutor_id}",
                    # El diagnóstico (CU-A2) no cuenta para progreso, informe ni gráficos.
                    "activity": "eq.practice",
                    "order": "answered_at.desc",
                    "limit": str(limit),
                },
            )
        except httpx.HTTPError:
            raise GatewayError("transport") from None
        if response.status_code != 200:
            raise GatewayError(f"status_{response.status_code}")
        try:
            rows = response.json()
            if not isinstance(rows, list):
                raise TypeError
            return [
                AttemptRow(
                    topic=str(r["topic"]),
                    correct=bool(r["correct"]),
                    answered_at=datetime.fromisoformat(str(r["answered_at"])),
                    duration_s=_duration(r.get("duration_s")),
                )
                for r in rows
            ]
        except (ValueError, TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def list_skill_progress(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> dict[str, SkillProgress]:
        rows = await self._select(
            "/student_skill_progress",
            # La llave de servidor ignora RLS: se acota a mano al tutor Y al perfil.
            {
                "select": "skill_code,level,block_total,block_correct,mastered_at",
                "student_id": f"eq.{student_id}",
                "tutor_id": f"eq.{tutor_id}",
            },
        )
        try:
            result: dict[str, SkillProgress] = {}
            for r in rows:
                code = r["skill_code"]
                values = (r["level"], r["block_total"], r["block_correct"])
                if not isinstance(code, str):
                    raise TypeError
                if any(isinstance(v, bool) or not isinstance(v, int) for v in values):
                    raise TypeError
                level, total, right = values
                if not (MIN_LEVEL <= level <= MAX_LEVEL and 0 <= right <= total < BLOCK_SIZE):
                    raise ValueError
                result[code] = SkillProgress(level, total, right, r["mastered_at"] is not None)
            return result
        except (ValueError, TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def list_recent_exercises(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, topic: str, limit: int
    ) -> list[str]:
        rows = await self._select(
            "/student_attempts",
            # La llave de servidor ignora RLS: se acota a mano al tutor Y al perfil.
            {
                "select": "exercise",
                "student_id": f"eq.{student_id}",
                "tutor_id": f"eq.{tutor_id}",
                "topic": f"eq.{topic}",
                # El bloque de 10 es solo de práctica: el diagnóstico no cuenta.
                "activity": "eq.practice",
                "order": "answered_at.desc",
                "limit": str(limit),
            },
        )
        try:
            texts = [r["exercise"] for r in rows]
            if not all(isinstance(t, str) for t in texts):
                raise TypeError
            return texts
        except (TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def _select(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        """GET a PostgREST. Falla cerrado ante red, estado o forma inesperados."""
        if not self._key:
            raise GatewayError("not_configured")
        try:
            response = await self._get_client().get(path, params=params)
        except httpx.HTTPError:
            raise GatewayError("transport") from None
        if response.status_code != 200:
            raise GatewayError(f"status_{response.status_code}")
        try:
            rows = response.json()
        except ValueError:
            raise GatewayError("unexpected_result") from None
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise GatewayError("unexpected_result")
        return rows

    async def create_assignment(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, text: str, answer: int
    ) -> str:
        result = await self._rpc(
            "create_assignment",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_text": text,
                "p_answer": answer,
            },
        )
        if result not in ("ok", "student_not_found", "limit"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def delete_assignment(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, assignment_id: uuid.UUID
    ) -> str:
        result = await self._rpc(
            "delete_assignment",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_assignment_id": str(assignment_id),
            },
        )
        if result not in ("ok", "not_found"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def list_assignments(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, *, pending_only: bool, limit: int
    ) -> list[AssignmentRow]:
        if not self._key:
            raise GatewayError("not_configured")
        params = {
            "select": "id,text,answer,created_at,answered_at,correct",
            # La llave de servidor ignora RLS: se acota a mano al tutor Y al perfil.
            "student_id": f"eq.{student_id}",
            "tutor_id": f"eq.{tutor_id}",
            "order": "answered_at.desc.nullsfirst,created_at.asc",
            "limit": str(limit),
        }
        if pending_only:
            params["answered_at"] = "is.null"
        try:
            response = await self._get_client().get("/assigned_exercises", params=params)
        except httpx.HTTPError:
            raise GatewayError("transport") from None
        if response.status_code != 200:
            raise GatewayError(f"status_{response.status_code}")
        try:
            rows = response.json()
            if not isinstance(rows, list):
                raise TypeError
            result = []
            for r in rows:
                answer, correct = r["answer"], r["correct"]
                if isinstance(answer, bool) or not isinstance(answer, int):
                    raise TypeError
                if correct is not None and not isinstance(correct, bool):
                    raise TypeError
                answered = r["answered_at"]
                result.append(
                    AssignmentRow(
                        id=uuid.UUID(str(r["id"])),
                        text=str(r["text"]),
                        answer=answer,
                        created_at=datetime.fromisoformat(str(r["created_at"])),
                        answered_at=datetime.fromisoformat(str(answered)) if answered else None,
                        correct=correct,
                    )
                )
            return result
        except (ValueError, TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def answer_assignment(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        assignment_id: uuid.UUID,
        answer: int,
        local_day: date | None,
        duration_s: int | None = None,
    ) -> AssignmentAnswer:
        result = await self._rpc(
            "answer_assignment",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_assignment_id": str(assignment_id),
                "p_answer": answer,
                "p_local_day": local_day.isoformat() if local_day else None,
                "p_duration_s": duration_s,
            },
        )
        if not isinstance(result, dict) or result.get("status") not in (
            "ok",
            "duplicate",
            "not_found",
        ):
            raise GatewayError("unexpected_result")
        if result["status"] != "ok":
            return AssignmentAnswer(str(result["status"]))
        correct, value = result.get("correct"), result.get("answer")
        if not isinstance(correct, bool) or isinstance(value, bool) or not isinstance(value, int):
            raise GatewayError("unexpected_result")
        return AssignmentAnswer("ok", correct, value)

    @staticmethod
    def _when(value: object) -> datetime | None:
        if value is None:
            return None
        return datetime.fromisoformat(str(value))

    async def delete_student(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        result = await self._rpc(
            "delete_student", {"p_tutor_id": str(tutor_id), "p_student_id": str(student_id)}
        )
        if result not in ("ok", "not_found"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def revoke_consent(self, tutor_id: uuid.UUID) -> str:
        result = await self._rpc("revoke_consent", {"p_tutor_id": str(tutor_id)})
        if result not in ("ok", "already_revoked", "no_consent"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def consent_summary(self, tutor_id: uuid.UUID) -> ConsentSummary:
        result = await self._rpc("consent_revocation_summary", {"p_tutor_id": str(tutor_id)})
        try:
            if not isinstance(result, dict):
                raise TypeError
            last, when = result["last_event"], result["occurred_at"]
            days, purge_at = result["purge_after_days"], result["purge_at"]
            if last not in (None, "grant", "revoke"):
                raise ValueError
            total, active = result["profiles_total"], result["profiles_active"]
            if any(isinstance(n, bool) or not isinstance(n, int) for n in (total, active)):
                raise TypeError
            if days is not None and (isinstance(days, bool) or not isinstance(days, int)):
                raise TypeError
            return ConsentSummary(
                last_event=last,
                occurred_at=datetime.fromisoformat(str(when)) if when else None,
                profiles_total=total,
                profiles_active=active,
                purge_after_days=days,
                purge_at=datetime.fromisoformat(str(purge_at)) if purge_at else None,
            )
        except (KeyError, TypeError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def archive_consent_evidence(
        self, tutor_id: uuid.UUID, tutor_ref: str, key_version: int
    ) -> int:
        result = await self._rpc(
            "archive_consent_evidence",
            {
                "p_tutor_id": str(tutor_id),
                "p_tutor_ref": tutor_ref,
                "p_key_version": key_version,
            },
        )
        if isinstance(result, bool) or not isinstance(result, int):
            raise GatewayError("unexpected_result")
        return result

    async def consent_evidence_complete(self, tutor_id: uuid.UUID) -> bool:
        result = await self._rpc("consent_evidence_is_complete", {"p_tutor_id": str(tutor_id)})
        if not isinstance(result, bool):
            raise GatewayError("unexpected_result")
        return result

    async def purge_auth_audit(self, tutor_id: uuid.UUID, email: str | None) -> int:
        result = await self._rpc(
            "purge_auth_audit", {"p_tutor_id": str(tutor_id), "p_email": email}
        )
        if isinstance(result, bool) or not isinstance(result, int):
            raise GatewayError("unexpected_result")
        return result

    async def tutor_exists(self, tutor_id: uuid.UUID) -> bool:
        result = await self._rpc("tutor_exists", {"p_tutor_id": str(tutor_id)})
        if not isinstance(result, bool):
            raise GatewayError("unexpected_result")
        return result

    async def get_pin_state(self, tutor_id: uuid.UUID) -> PinState | None:
        rows = await self._rpc("get_tutor_pin_state", {"p_tutor_id": str(tutor_id)})
        if not isinstance(rows, list) or len(rows) > 1:
            raise GatewayError("unexpected_result")
        if not rows:
            return None
        try:
            row = rows[0]
            attempts = row["failed_attempts"]
            if isinstance(attempts, bool) or not isinstance(attempts, int):
                raise TypeError
            return PinState(str(row["pin_hash"]), self._when(row["locked_until"]), attempts)
        except (ValueError, TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def set_pin(self, tutor_id: uuid.UUID, pin_hash: str) -> None:
        await self._rpc("set_tutor_pin", {"p_tutor_id": str(tutor_id), "p_pin_hash": pin_hash})

    async def register_pin_attempt(
        self, tutor_id: uuid.UUID, success: bool
    ) -> tuple[datetime | None, int]:
        rows = await self._rpc(
            "register_pin_attempt", {"p_tutor_id": str(tutor_id), "p_success": success}
        )
        try:
            if not isinstance(rows, list) or len(rows) != 1:
                raise TypeError
            attempts = rows[0]["failed_attempts"]
            if isinstance(attempts, bool) or not isinstance(attempts, int):
                raise TypeError
            return self._when(rows[0]["locked_until"]), attempts
        except (ValueError, TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def get_daily_streak(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> DailyStreakRow | None:
        if not self._key:
            raise GatewayError("not_configured")
        try:
            response = await self._get_client().get(
                "/student_daily_streaks",
                # La llave de servidor ignora RLS: se acota a mano al tutor Y al perfil.
                params={
                    "select": "current_len,last_day",
                    "student_id": f"eq.{student_id}",
                    "tutor_id": f"eq.{tutor_id}",
                    "limit": "1",
                },
            )
        except httpx.HTTPError:
            raise GatewayError("transport") from None
        if response.status_code != 200:
            raise GatewayError(f"status_{response.status_code}")
        try:
            rows = response.json()
            if not isinstance(rows, list):
                raise TypeError
            if not rows:
                return None
            return DailyStreakRow(
                current_len=int(rows[0]["current_len"]),
                last_day=date.fromisoformat(str(rows[0]["last_day"])),
            )
        except (ValueError, TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def assert_read_committed(self) -> None:
        await self._rpc("assert_read_committed", {})

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def admin_create_teacher(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID, name: str, link_code: str
    ) -> str:
        result = await self._rpc(
            "admin_create_teacher",
            {
                "p_admin_id": str(admin_id),
                "p_teacher_id": str(teacher_id),
                "p_name": name,
                "p_link_code": link_code,
            },
        )
        if result not in ("ok", "code_taken"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def admin_list_teachers(self) -> list[TeacherRow]:
        result = await self._rpc("admin_list_teachers", {})
        try:
            if not isinstance(result, list):
                raise TypeError
            return [
                TeacherRow(
                    id=uuid.UUID(str(row["id"])),
                    name=str(row["name"]),
                    email=str(row["email"] or ""),
                    link_code=str(row["link_code"]),
                )
                for row in result
            ]
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def teacher_profile(self, teacher_id: uuid.UUID) -> TeacherProfile | None:
        result = await self._rpc("teacher_profile", {"p_teacher_id": str(teacher_id)})
        if result is None:
            return None
        try:
            return TeacherProfile(name=str(result["name"]), link_code=str(result["link_code"]))
        except (TypeError, KeyError):
            raise GatewayError("unexpected_result") from None

    async def admin_get_teacher(self, teacher_id: uuid.UUID) -> TeacherRow | None:
        result = await self._rpc("admin_get_teacher", {"p_teacher_id": str(teacher_id)})
        if result is None:
            return None
        try:
            return TeacherRow(
                id=uuid.UUID(str(result["id"])),
                name=str(result["name"]),
                email=str(result["email"] or ""),
                link_code=str(result["link_code"]),
            )
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def admin_update_teacher(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID, name: str, email_changed: bool
    ) -> str:
        result = await self._rpc(
            "admin_update_teacher",
            {
                "p_admin_id": str(admin_id),
                "p_teacher_id": str(teacher_id),
                "p_name": name,
                "p_email_changed": email_changed,
            },
        )
        if result not in ("ok", "unchanged", "not_found"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def admin_record_teacher_deleted(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> None:
        await self._rpc(
            "admin_record_teacher_deleted",
            {"p_admin_id": str(admin_id), "p_teacher_id": str(teacher_id)},
        )

    async def admin_email_in_use(self, email: str, except_id: uuid.UUID) -> bool:
        result = await self._rpc(
            "admin_email_in_use", {"p_email": email, "p_except_id": str(except_id)}
        )
        if not isinstance(result, bool):
            raise GatewayError("unexpected_result")
        return result

    async def admin_revoke_teacher_sessions(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> int:
        result = await self._rpc(
            "admin_revoke_teacher_sessions",
            {"p_admin_id": str(admin_id), "p_teacher_id": str(teacher_id)},
        )
        if isinstance(result, bool) or not isinstance(result, int):
            raise GatewayError("unexpected_result")
        return result

    async def teacher_link_lookup(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, code: str
    ) -> LinkLookup:
        result = await self._rpc(
            "teacher_link_lookup",
            {"p_tutor_id": str(tutor_id), "p_student_id": str(student_id), "p_code": code},
        )
        try:
            status = str(result["status"])
            if status not in (
                "ok",
                "not_found",
                "locked",
                "already_linked",
                "student_not_found",
                "no_terms",
            ):
                raise ValueError
            if status == "locked":
                return LinkLookup(status, retry_after=int(result["retry_after"]))
            if status != "ok":
                return LinkLookup(status)
            return LinkLookup(
                status,
                teacher_id=uuid.UUID(str(result["teacher_id"])),
                name=str(result["name"]),
                terms_id=uuid.UUID(str(result["terms_id"])),
                terms_version=str(result["terms_version"]),
                terms_sha256=str(result["terms_sha256"]),
            )
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def create_teacher_link(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        teacher_id: uuid.UUID,
        teacher_name: str,
        terms_version_id: uuid.UUID,
    ) -> str:
        result = await self._rpc(
            "create_teacher_link",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_teacher_id": str(teacher_id),
                "p_teacher_name": teacher_name,
                "p_terms_version_id": str(terms_version_id),
            },
        )
        if result not in (
            "ok",
            "already_linked",
            "student_not_found",
            "teacher_not_found",
            "name_changed",
            "terms_outdated",
            "consent_required",
        ):
            raise GatewayError("unexpected_result")
        return str(result)

    async def list_student_teachers(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> list[LinkedTeacher] | None:
        result = await self._rpc(
            "list_student_teachers",
            {"p_tutor_id": str(tutor_id), "p_student_id": str(student_id)},
        )
        if result is None:
            return None
        try:
            if not isinstance(result, list):
                raise TypeError
            return [
                LinkedTeacher(
                    teacher_id=uuid.UUID(str(row["teacher_id"])),
                    name=str(row["name"]),
                    shown_name=str(row["shown_name"]),
                    accepted_at=datetime.fromisoformat(str(row["accepted_at"])),
                )
                for row in result
            ]
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def remove_teacher_link(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> str:
        result = await self._rpc(
            "remove_teacher_link",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_teacher_id": str(teacher_id),
            },
        )
        if result not in ("ok", "not_found"):
            raise GatewayError("unexpected_result")
        return str(result)

    async def teacher_students(self, teacher_id: uuid.UUID) -> list[TeacherStudent]:
        result = await self._rpc("teacher_students", {"p_teacher_id": str(teacher_id)})
        try:
            if not isinstance(result, list):
                raise TypeError
            return [
                TeacherStudent(
                    student_id=uuid.UUID(str(row["student_id"])),
                    nickname=str(row["nickname"]),
                    grade=int(row["grade"]),
                )
                for row in result
            ]
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def teacher_student_progress(
        self, teacher_id: uuid.UUID, student_id: uuid.UUID
    ) -> TeacherProgress | None:
        result = await self._rpc(
            "teacher_student_progress",
            {"p_teacher_id": str(teacher_id), "p_student_id": str(student_id)},
        )
        if result is None:
            return None
        try:
            return TeacherProgress(
                nickname=str(result["nickname"]),
                grade=int(result["grade"]),
                skills=[
                    SkillState(
                        code=str(k["code"]),
                        level=int(k["level"]),
                        block_total=int(k["block_total"]),
                        block_correct=int(k["block_correct"]),
                        mastered=bool(k["mastered"]),
                    )
                    for k in result["skills"]
                ],
            )
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def teacher_student_history(
        self, teacher_id: uuid.UUID, student_id: uuid.UUID, offset: int, limit: int
    ) -> HistoryPage | None:
        result = await self._rpc(
            "teacher_student_history",
            {
                "p_teacher_id": str(teacher_id),
                "p_student_id": str(student_id),
                "p_offset": offset,
                "p_limit": limit,
            },
        )
        if result is None:
            return None
        try:
            return HistoryPage(
                items=[
                    HistoryItem(
                        topic=str(i["topic"]),
                        exercise=None if i["exercise"] is None else str(i["exercise"]),
                        correct=bool(i["correct"]),
                        level=int(i["level"]),
                        day=str(i["day"]),
                    )
                    for i in result["items"]
                ],
                has_more=bool(result["has_more"]),
            )
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None

    async def list_student_attempts(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, offset: int, limit: int
    ) -> TutorHistoryPage | None:
        result = await self._rpc(
            "list_student_attempts",
            {
                "p_tutor_id": str(tutor_id),
                "p_student_id": str(student_id),
                "p_offset": offset,
                "p_limit": limit,
            },
        )
        if result is None:
            return None
        try:
            return TutorHistoryPage(
                items=[
                    TutorAttempt(
                        topic=str(i["topic"]),
                        correct=bool(i["correct"]),
                        level=int(i["level"]),
                        answered_at=datetime.fromisoformat(str(i["answered_at"])),
                    )
                    for i in result["items"]
                ],
                has_more=bool(result["has_more"]),
            )
        except (TypeError, KeyError, ValueError):
            raise GatewayError("unexpected_result") from None
