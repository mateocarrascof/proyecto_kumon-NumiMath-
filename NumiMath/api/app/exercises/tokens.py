"""Token firmado de un ejercicio.

El token NO contiene la respuesta ni la semilla: lleva un identificador aleatorio (`jti`), el
perfil, el tema, el nivel de dificultad y la hora de caducidad, firmados con HMAC-SHA256. La
respuesta se recalcula en el servidor: la semilla del generador es HMAC(clave, jti), que el
cliente no puede calcular.

Garantías:
- no sirve en otro perfil (el id del perfil va firmado y se compara con el de la ruta);
- caduca pronto (`exp`);
- no se puede alterar (firma comparada en tiempo constante);
- una vez respondido no cuenta de nuevo (restricción única en la base, por `jti`).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import time
import uuid
from dataclasses import dataclass

from app.exercises.generators import Exercise, generate
from app.exercises.levels import MAX_LEVEL, MIN_LEVEL

# v4: el tema es un código de habilidad del catálogo ("1-06") y puede haber respuestas con
# fracción. v3 agregó la hora de emisión ("i"). Versiones anteriores se rechazan (vivían pocos
# minutos).
_VERSION = 4


class InvalidExercise(Exception):
    """Token mal formado, alterado, vencido o de otro perfil. No se explica cuál."""


@dataclass(frozen=True)
class IssuedExercise:
    token: str
    exercise_id: uuid.UUID
    topic: str
    level: int
    exercise: Exercise
    expires_at: int


@dataclass(frozen=True)
class VerifiedExercise:
    exercise_id: uuid.UUID
    topic: str
    level: int
    exercise: Exercise
    issued_at: int


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(key: bytes, payload: bytes) -> bytes:
    return hmac.new(key, b"exercise-token|" + payload, hashlib.sha256).digest()


def _rng(key: bytes, exercise_id: uuid.UUID) -> random.Random:
    digest = hmac.new(key, b"exercise-seed|" + exercise_id.bytes, hashlib.sha256).digest()
    # El azar solo elige números del ejercicio; el secreto está en la semilla (HMAC), no en el PRNG.
    return random.Random(int.from_bytes(digest[:8], "big"))  # noqa: S311


def issue(
    key: bytes,
    student_id: uuid.UUID,
    topic: str,
    ttl_seconds: int,
    now: float | None = None,
    level: int = MIN_LEVEL,
) -> IssuedExercise | None:
    """Crea un ejercicio nuevo. `None` si el tema no tiene generador o el nivel no existe."""
    if not MIN_LEVEL <= level <= MAX_LEVEL:
        return None
    exercise_id = uuid.uuid4()
    exercise = generate(topic, _rng(key, exercise_id), level)
    if exercise is None:
        return None
    issued_at = int(time.time() if now is None else now)
    expires_at = issued_at + ttl_seconds
    payload = json.dumps(
        {
            "v": _VERSION,
            "j": str(exercise_id),
            "s": str(student_id),
            "t": topic,
            "l": level,
            "i": issued_at,
            "e": expires_at,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    token = f"{_b64(payload)}.{_b64(_sign(key, payload))}"
    return IssuedExercise(token, exercise_id, topic, level, exercise, expires_at)


def verify(
    key: bytes, token: str, student_id: uuid.UUID, now: float | None = None
) -> VerifiedExercise:
    try:
        payload_b64, signature_b64 = token.split(".")
        payload = _unb64(payload_b64)
        signature = _unb64(signature_b64)
    except (ValueError, TypeError):
        raise InvalidExercise from None
    if not hmac.compare_digest(signature, _sign(key, payload)):
        raise InvalidExercise
    try:
        data = json.loads(payload)
        exercise_id = uuid.UUID(data["j"])
        owner = uuid.UUID(data["s"])
        topic = str(data["t"])
        expires_at = int(data["e"])
        version = int(data["v"])
        level = int(data["l"])
        issued_at = int(data["i"])
    except (ValueError, KeyError, TypeError):
        raise InvalidExercise from None
    if version != _VERSION or owner != student_id or not MIN_LEVEL <= level <= MAX_LEVEL:
        raise InvalidExercise
    if (time.time() if now is None else now) >= expires_at:
        raise InvalidExercise
    exercise = generate(topic, _rng(key, exercise_id), level)
    if exercise is None:
        raise InvalidExercise
    return VerifiedExercise(exercise_id, topic, level, exercise, issued_at)
