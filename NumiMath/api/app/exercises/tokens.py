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

Diagnóstico inicial (CU-A2): con `step` (0 a 5) el token lleva además el paso de la prueba y se
firma con OTRO dominio. Así un token de práctica no sirve para el diagnóstico ni al revés: el
niño no puede llevar al diagnóstico un ejercicio fácil de práctica (ni responder en práctica, con
racha y bloque, un ejercicio del diagnóstico).

Modo sin conexión (CU-A12, ADR 0002): con `offline=True` el token se firma con un tercer dominio
(`offline-token|`) y lleva la versión 5. Vive días (no minutos) porque el niño lo responde sin
internet; por eso NO puede servir en la práctica en línea ni al revés: un token de 10 minutos no
se puede "estirar" a 7 días y uno del lote no entra por la ruta de responder en línea.
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
# Versión propia de los tokens del lote sin conexión (dominio `offline-token|`).
_OFFLINE_VERSION = 5


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
    step: int | None = None  # paso del diagnóstico (0 a 5); None en la práctica
    # Caducidad firmada (segundos). CU-A13 la usa para acotar la hora y la fecha del intento.
    expires_at: int = 0


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(key: bytes, payload: bytes, diagnostic: bool = False, offline: bool = False) -> bytes:
    if offline:
        domain = b"offline-token|"
    elif diagnostic:
        domain = b"diagnostic-token|"
    else:
        domain = b"exercise-token|"
    return hmac.new(key, domain + payload, hashlib.sha256).digest()


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
    step: int | None = None,
    offline: bool = False,
) -> IssuedExercise | None:
    """Crea un ejercicio nuevo. `None` si el tema no tiene generador o el nivel no existe.

    Con `step` es un ejercicio del diagnóstico (firma de otro dominio). Con `offline` es un
    ejercicio del lote sin conexión (otro dominio y versión). No se pueden combinar."""
    if not MIN_LEVEL <= level <= MAX_LEVEL or (offline and step is not None):
        return None
    exercise_id = uuid.uuid4()
    exercise = generate(topic, _rng(key, exercise_id), level)
    if exercise is None:
        return None
    issued_at = int(time.time() if now is None else now)
    expires_at = issued_at + ttl_seconds
    data: dict[str, object] = {
        "v": _OFFLINE_VERSION if offline else _VERSION,
        "j": str(exercise_id),
        "s": str(student_id),
        "t": topic,
        "l": level,
        "i": issued_at,
        "e": expires_at,
    }
    if step is not None:
        data["d"] = step
    payload = json.dumps(data, separators=(",", ":"), sort_keys=True).encode()
    signature = _sign(key, payload, diagnostic=step is not None, offline=offline)
    token = f"{_b64(payload)}.{_b64(signature)}"
    return IssuedExercise(token, exercise_id, topic, level, exercise, expires_at)


def verify(
    key: bytes,
    token: str,
    student_id: uuid.UUID,
    now: float | None = None,
    diagnostic: bool = False,
    offline: bool = False,
    grace_s: int = 0,
) -> VerifiedExercise:
    """Comprueba un token. Con `diagnostic=True` solo acepta tokens del diagnóstico (y exige el
    paso); con `offline=True`, solo del lote sin conexión; sin ninguno, solo de práctica."""
    if diagnostic and offline:
        raise InvalidExercise
    # CU-A13: el margen para sincronizar (14 días) existe SOLO para tokens del lote sin conexión.
    # Pedirlo con un token de práctica o de diagnóstico es un error: nunca se alarga su caducidad.
    if grace_s < 0 or (grace_s and not offline):
        raise InvalidExercise
    try:
        payload_b64, signature_b64 = token.split(".")
        payload = _unb64(payload_b64)
        signature = _unb64(signature_b64)
    except (ValueError, TypeError):
        raise InvalidExercise from None
    expected = _sign(key, payload, diagnostic=diagnostic, offline=offline)
    if not hmac.compare_digest(signature, expected):
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
        step = int(data["d"]) if diagnostic else None
    except (ValueError, KeyError, TypeError):
        raise InvalidExercise from None
    wanted = _OFFLINE_VERSION if offline else _VERSION
    if version != wanted or owner != student_id or not MIN_LEVEL <= level <= MAX_LEVEL:
        raise InvalidExercise
    if (time.time() if now is None else now) >= expires_at + grace_s:
        raise InvalidExercise
    exercise = generate(topic, _rng(key, exercise_id), level)
    if exercise is None:
        raise InvalidExercise
    return VerifiedExercise(exercise_id, topic, level, exercise, issued_at, step, expires_at)
