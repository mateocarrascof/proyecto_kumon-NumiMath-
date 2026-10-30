"""Registro de eventos SIN datos personales (CLAUDE.md y ADR 0001).

Regla: se registran códigos de evento y campos de una lista cerrada. Nunca mensajes del niño,
apodos, correos, cuerpos de petición ni respuestas de la IA. Hay dos barreras:

1. `log_event` descarta cualquier campo que no esté en `ALLOWED_FIELDS`;
2. el formateador redacta patrones de datos personales que pudieran colarse en un mensaje.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any

# Lista cerrada. Añadir un campo exige revisar que no pueda contener datos personales.
ALLOWED_FIELDS: frozenset[str] = frozenset(
    {"request_id", "method", "route", "status", "duration_ms", "code", "stage", "outcome"}
)

_REDACTIONS: tuple[re.Pattern[str], ...] = (
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),  # correos
    re.compile(r"https?://\S+", re.IGNORECASE),  # URLs
    re.compile(r"\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b"),  # RUT chileno
    re.compile(r"\+?\d[\d\s().-]{7,}\d"),  # teléfonos y números largos
)

REDACTED = "[redactado]"


def redact(text: str) -> str:
    for pattern in _REDACTIONS:
        text = pattern.sub(REDACTED, text)
    return text


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "event": redact(record.getMessage()),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            for key, value in fields.items():
                if key in ALLOWED_FIELDS:
                    payload[key] = redact(value) if isinstance(value, str) else value
        # Nunca se vuelca el texto de una excepción: puede contener datos del usuario.
        if record.exc_info:
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else "unknown"
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger("mathtutor")
    root.setLevel(level)
    if not any(getattr(h, "_mathtutor", False) for h in root.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        handler._mathtutor = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    root.propagate = False


def get_logger(name: str = "mathtutor") -> logging.Logger:
    return logging.getLogger(name)


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields: Any) -> None:
    """Registra `event` (un código estable, no texto libre) con campos de la lista cerrada."""
    safe = {k: v for k, v in fields.items() if k in ALLOWED_FIELDS}
    logger.log(level, event, extra={"fields": safe})
