"""Regla fija: toda conexión a la base usa READ COMMITTED (ADR 0001, decisión 2.3).

Las rutas que toman el bloqueo por tutor (altas de perfiles, eventos de consentimiento,
bloqueos y consumo de cuota) leen el estado con una vista nueva por sentencia. Bajo
REPEATABLE READ o SERIALIZABLE, dos altas simultáneas podrían superar el tope.

No es configurable. La base además lo exige (migración 20261013100000_api_support).
"""

from __future__ import annotations

from typing import Final

ISOLATION_LEVEL: Final[str] = "read committed"


class IsolationLevelError(RuntimeError):
    """La conexión no usa el nivel de aislamiento exigido."""


def require_read_committed(level: str) -> None:
    """Falla cerrado si `level` (p. ej. `show transaction_isolation`) no es READ COMMITTED."""
    if level.strip().lower() != ISOLATION_LEVEL:
        raise IsolationLevelError("isolation_level_not_allowed")
