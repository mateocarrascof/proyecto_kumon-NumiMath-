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
    GatewayError,
    PinState,
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

    async def archive_consent_evidence(
        self, tutor_id: uuid.UUID, tutor_ref: str, email_ref: str, key_version: int
    ) -> int:
        result = await self._rpc(
            "archive_consent_evidence",
            {
                "p_tutor_id": str(tutor_id),
                "p_tutor_ref": tutor_ref,
                "p_email_ref": email_ref,
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
