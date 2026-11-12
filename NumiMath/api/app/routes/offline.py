"""Descarga del lote para practicar sin conexión (CU-A12, ADR 0002).

Orden: JWT → perfil del tutor, no bloqueado y con consentimiento (AuthorizedStudentDep, ADR 0001)
→ curso leído de la base → progreso por habilidad → límite de descargas por perfil y día →
generación. El límite se descuenta al final, justo antes de generar: si la base falla antes, no
se gasta una de las descargas del día sin entregar lote.
No usa IA. No guarda el lote en la base: los tokens son firmados y sin estado (el `jti` único de
`student_attempts` seguirá garantizando una sola respuesta al sincronizar, CU-A13).

Contenido: las habilidades del CURSO del perfil que tienen generador (el repaso de cursos
anteriores no va en el lote) y, por habilidad, `offline_batch_per_level` ejercicios en el nivel
actual y en cada nivel vecino.
"""

from __future__ import annotations

import secrets
import time
import uuid
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.ai.topics import topics_for_grade
from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.generators import GENERATORS
from app.exercises.levels import BLOCK_SIZE, SkillProgress
from app.exercises.offline import build_topic_items
from app.logging import get_logger, log_event
from app.routes.common import signing_key, student_grade

router = APIRouter(prefix="/v1/students", tags=["offline"])
logger = get_logger("mathtutor.offline")


class OfflineTopicOut(BaseModel):
    id: str
    label: str
    module: str
    grade: int
    level: int
    block_done: int
    # Aciertos del bloque en curso: la app los necesita para repetir la regla del bloque de 10
    # sin conexión (solo para mostrar; la decisión real la toma el servidor al sincronizar).
    block_correct: int
    block_size: int = BLOCK_SIZE
    mastered: bool


class OfflineExerciseOut(BaseModel):
    token: str
    topic: str
    level: int
    text: str
    answer_kind: Literal["integer", "fraction"] = "integer"
    solution_hash: str


class OfflineBatchOut(BaseModel):
    salt: str
    issued_at: int
    expires_at: int
    topics: list[OfflineTopicOut]
    exercises: list[OfflineExerciseOut]


def _build_batch(
    key: bytes,
    student_id: uuid.UUID,
    grade: int,
    progress: dict[str, SkillProgress],
    per_level: int,
    ttl: int,
    salt: str,
    now: int,
) -> tuple[list[OfflineTopicOut], list[OfflineExerciseOut]]:
    """Genera el lote. Es CPU pura (cientos de HMAC y generadores): se corre fuera del event loop
    para no frenar a las demás peticiones (incluido el streaming de la IA)."""
    topics: list[OfflineTopicOut] = []
    exercises: list[OfflineExerciseOut] = []
    for t in topics_for_grade(grade):
        if t.grade != grade or t.id not in GENERATORS:
            continue
        p = progress.get(t.id, SkillProgress())
        items = build_topic_items(key, student_id, t.id, p.level, per_level, ttl, salt, now=now)
        if not items:
            continue
        topics.append(
            OfflineTopicOut(
                id=t.id,
                label=t.label,
                module=t.module,
                grade=t.grade,
                level=p.level,
                block_done=p.block_total,
                block_correct=p.block_correct,
                mastered=p.mastered,
            )
        )
        exercises.extend(
            OfflineExerciseOut(
                token=i.token,
                topic=i.topic,
                level=i.level,
                text=i.text,
                answer_kind="fraction" if i.is_fraction else "integer",
                solution_hash=i.solution_hash,
            )
            for i in items
        )
    return topics, exercises


@router.post("/{student_id}/offline-batch")
async def create_offline_batch(student: AuthorizedStudentDep, request: Request) -> OfflineBatchOut:
    settings = request.app.state.settings
    key = signing_key(request)
    grade = await student_grade(request, student.tutor_id, student.student_id)
    gateway: Gateway = request.app.state.gateway

    # Falla cerrado: sin el progreso real, el lote saldría en nivel 1 y el niño vería sin
    # conexión un nivel que no es el suyo. Mejor no entregar lote (la app lo reintenta luego).
    # Se lee ANTES de descontar el límite: si falla, no se gasta una descarga del día.
    try:
        progress = await gateway.list_skill_progress(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "offline_batch.denied", stage="progress", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None

    try:
        outcome = await gateway.consume_offline_batch(
            student.tutor_id, student.student_id, settings.offline_batch_daily_limit
        )
    except GatewayError as exc:
        log_event(logger, "offline_batch.denied", stage="limit", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome == "limit":
        log_event(logger, "offline_batch.denied", stage="limit", code="daily_limit")
        raise ApiError(429, "offline_batch_limit")
    if outcome != "ok":
        raise ApiError(403, "forbidden")

    now = int(time.time())
    ttl = settings.offline_token_ttl_seconds
    # Sal aleatoria por lote: el mismo resultado no da el mismo hash en dos lotes.
    salt = secrets.token_hex(16)
    topics, exercises = await run_in_threadpool(
        _build_batch,
        key,
        student.student_id,
        grade,
        progress,
        settings.offline_batch_per_level,
        ttl,
        salt,
        now,
    )
    # Solo el código del evento: nunca enunciados ni datos del perfil.
    log_event(logger, "offline_batch.issued")
    return OfflineBatchOut(
        salt=salt, issued_at=now, expires_at=now + ttl, topics=topics, exercises=exercises
    )
