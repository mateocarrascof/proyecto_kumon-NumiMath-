"""Tiempo por ejercicio: cálculo de segundos y ticket firmado de las tareas del tutor.

- Ejercicios: la hora de emisión va firmada en el token (`tokens.py`, campo `i`).
- Tareas: al abrir una, el servidor entrega un ticket firmado con (tarea, perfil, hora). Al
  responder, si el ticket es válido y de esa misma tarea y perfil, se calcula la duración; si no,
  el intento se registra sin duración (nunca se bloquea la respuesta por esto).
La clave se deriva de la de ejercicios con separación de dominio. La app no envía tiempos.
Reglas: docs/SPEC.md ("Tiempo por ejercicio").
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Final

MAX_DURATION_S: Final = 600


def duration_since(issued_at: float, now: float | None = None) -> int | None:
    """Segundos desde `issued_at`; `None` si no es creíble (futuro o más del tope)."""
    elapsed = (time.time() if now is None else now) - issued_at
    if elapsed < -5 or elapsed > MAX_DURATION_S:
        return None
    return max(0, int(round(elapsed)))


def _key(signing_key: bytes) -> bytes:
    return hmac.new(signing_key, b"assignment-ticket-key", hashlib.sha256).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_ticket(
    signing_key: bytes, assignment_id: uuid.UUID, student_id: uuid.UUID, now: float | None = None
) -> str:
    payload = json.dumps(
        {
            "a": str(assignment_id),
            "s": str(student_id),
            "i": int(time.time() if now is None else now),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    signature = hmac.new(_key(signing_key), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(signature)}"


def ticket_duration(
    signing_key: bytes,
    ticket: str | None,
    assignment_id: uuid.UUID,
    student_id: uuid.UUID,
    now: float | None = None,
) -> int | None:
    """Segundos desde que se abrió la tarea, o `None` si el ticket no sirve."""
    if not ticket or len(ticket) > 400:
        return None
    try:
        payload_b64, signature_b64 = ticket.split(".")
        payload, signature = _unb64(payload_b64), _unb64(signature_b64)
    except (ValueError, TypeError):
        return None
    expected = hmac.new(_key(signing_key), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        data = json.loads(payload)
        same = (
            uuid.UUID(str(data["a"])) == assignment_id and uuid.UUID(str(data["s"])) == student_id
        )
        issued_at = int(data["i"])
    except (ValueError, KeyError, TypeError):
        return None
    return duration_since(issued_at, now) if same else None
