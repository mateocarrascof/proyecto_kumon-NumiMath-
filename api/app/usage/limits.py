"""Límites de uso por perfil y por día, y tope de costo por tutor (ADR 0001, comprobación 4).

El conteo es ATÓMICO y vive en la base (`consume_usage`): dos peticiones simultáneas no pueden
pasarse del límite. El tope por TUTOR sobrevive al borrado de perfiles, para que crear y borrar
perfiles no reinicie la cuota. El día se cuenta en hora de Chile (lo decide la base).

Falla cerrado: si no se puede verificar la cuota, se deniega con 503.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.access.authorize import AuthorizedStudent
from app.config import Settings
from app.db.gateway import Gateway, GatewayError
from app.errors import ApiError
from app.logging import get_logger, log_event

logger = get_logger("mathtutor.usage")

# La medianoche de Chile cae a más tardar a las 04:00 UTC (UTC-4 en invierno; UTC-3 en horario
# de verano, a las 03:00 UTC). Se usa la cota más tardía para no invitar a reintentar antes de
# tiempo. Es solo una pista (`Retry-After`): el conteo real lo hace la base.
_RESET_UTC_HOUR = 4
_MIN_RETRY_SECONDS = 60


@dataclass(frozen=True)
class UsagePolicy:
    cost: int
    student_limit: int
    tutor_limit: int

    @classmethod
    def from_settings(cls, settings: Settings) -> UsagePolicy:
        return cls(
            cost=settings.cost_per_explanation,
            student_limit=settings.student_daily_limit,
            tutor_limit=settings.tutor_daily_limit,
        )


def seconds_until_reset(now: datetime | None = None) -> int:
    """Segundos hasta el próximo reinicio diario (cota conservadora, mínimo 60)."""
    now = (now or datetime.now(UTC)).astimezone(UTC)
    target = now.replace(hour=_RESET_UTC_HOUR, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max(_MIN_RETRY_SECONDS, int((target - now).total_seconds()))


async def consume_usage(
    gateway: Gateway,
    student: AuthorizedStudent,
    policy: UsagePolicy,
    now: datetime | None = None,
) -> None:
    """Consume cuota para UNA explicación. Lanza `ApiError` si no se puede."""
    try:
        code = await gateway.consume_usage(
            student.tutor_id,
            student.student_id,
            policy.cost,
            policy.student_limit,
            policy.tutor_limit,
        )
    except GatewayError as exc:
        log_event(logger, "usage.denied", stage="consume", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None

    if code == "ok":
        return

    if code in ("student_limit", "tutor_limit"):
        log_event(logger, "usage.denied", stage="consume", code=code)
        raise ApiError(
            429,
            "rate_limited",
            extra={"scope": "student" if code == "student_limit" else "tutor"},
            headers={"Retry-After": str(seconds_until_reset(now))},
        )

    # Respuesta desconocida: no se puede asegurar la cuota, se deniega.
    log_event(logger, "usage.denied", stage="consume", code="unexpected_code")
    raise ApiError(503, "service_unavailable")
