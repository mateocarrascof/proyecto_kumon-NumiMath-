"""Eliminar la cuenta del tutor y sus datos (T21), en el orden del ADR 0001, decisión 3.

    1 congelar   → revocar el consentimiento (bloquea los perfiles) y bloquear el acceso en Auth
    2 huella     → tutor_ref = HMAC-SHA256 del id con la clave del servidor (sin huella del correo)
    3 archivar   → evidencia mínima del consentimiento (sin identificadores en claro)
    4 archivar   → otra vez (idempotente): cubre lo que hubiera entrado entre 3 y 5
    5 borrar     → el usuario en Auth; la cascada borra tutor, perfiles, progreso, tareas, etc.
    6 verificar  → ya no queda el tutor

Si algo falla en 1 a 4 NO se borra nada y se descongela la cuenta. Si falla el paso 5 la
evidencia ya está archivada: se puede reintentar el flujo completo. Lo que se conserva después
de borrar es solo la evidencia mínima que exige la ley (versión y huella de los textos
aceptados, fechas, canal y el seudónimo del tutor), por el plazo de
`consent_evidence_retention_days` (5 años, provisional; lo borra pg_cron), y la declaración del
adulto archivada sin apodo ni curso. Reglas: docs/SPEC.md.

Nunca se registra el correo, el id ni la huella: los logs llevan solo códigos de paso.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

from app.auth.admin import AuthAdmin, AuthAdminError
from app.auth.jwt import AuthenticatedTutor
from app.config import Settings
from app.db.gateway import Gateway, GatewayError
from app.logging import get_logger, log_event

logger = get_logger("mathtutor.account")


class AccountDeletionError(Exception):
    """El borrado no se completó. `stage` y `code` son solo códigos, aptos para logs."""

    def __init__(self, stage: str, code: str) -> None:
        super().__init__(f"{stage}:{code}")
        self.stage = stage
        self.code = code


@dataclass(frozen=True)
class EvidenceKey:
    version: int
    secret: bytes


def evidence_key(settings: Settings) -> EvidenceKey | None:
    """Clave HMAC de la evidencia (ADR 0001, decisión 4).

    En producción es obligatoria (`HMAC_KEYS`, validada al arrancar). Fuera de producción, si no
    hay una configurada, se DERIVA de la clave de firma de ejercicios con separación de dominio,
    para poder probar el borrado en local sin otra variable. Esa clave derivada NO debe usarse con
    datos reales.
    """
    raw = settings.hmac_keys.get_secret_value()
    if raw:
        try:
            keys = json.loads(raw)
            version = settings.hmac_active_version
            return EvidenceKey(version, str(keys[str(version)]).encode())
        except (ValueError, KeyError, TypeError):
            return None
    base = settings.exercise_signing_key.get_secret_value()
    # Solo contra una base LOCAL (loopback): un despliegue real sin HMAC_KEYS NO debe archivar la
    # evidencia con una clave derivada de otra variable.
    host = (urlparse(settings.supabase_url).hostname or "").lower()
    if settings.app_env != "production" and base and host in {"127.0.0.1", "localhost", "::1"}:
        derived = hmac.new(base.encode(), b"evidence-hmac-dev-only", hashlib.sha256).digest()
        return EvidenceKey(1, derived)
    return None


def _ref(key: EvidenceKey, domain: bytes, value: str) -> str:
    return hmac.new(key.secret, domain + value.encode(), hashlib.sha256).hexdigest()


def tutor_ref(key: EvidenceKey, tutor_id: uuid.UUID) -> str:
    return _ref(key, b"tutor:", str(tutor_id))


async def delete_account(
    *, gateway: Gateway, admin: AuthAdmin, tutor: AuthenticatedTutor, key: EvidenceKey
) -> str:
    """Devuelve `deleted` o `already_deleted`. Lanza `AccountDeletionError` si no se completó."""
    tutor_id = tutor.tutor_id

    # Reintento: si el tutor ya no existe, solo falta (o ya está) borrado el usuario en Auth.
    try:
        exists = await gateway.tutor_exists(tutor_id)
    except GatewayError as exc:
        raise AccountDeletionError("state", f"gateway_{exc.reason}") from None
    if not exists:
        try:
            await admin.delete(tutor_id)
        except AuthAdminError as exc:
            raise AccountDeletionError("delete", f"auth_{exc.reason}") from None
        await _purge_audit(
            gateway, tutor_id, tutor.email
        )  # un reintento también limpia la auditoría
        return "already_deleted"

    try:
        email = tutor.email or await admin.get_email(tutor_id)
    except AuthAdminError as exc:
        raise AccountDeletionError("email", f"auth_{exc.reason}") from None
    if not email:
        raise AccountDeletionError("email", "missing")  # sin correo no hay huella: no se borra

    frozen = False
    try:
        # 1. Congelar.
        await gateway.revoke_consent(
            tutor_id
        )  # 'ok' | 'already_revoked' | 'no_consent': todos sirven
        await admin.ban(tutor_id)
        frozen = True
        # 2 y 3 y 4. Huellas y evidencia (dos veces: es idempotente).
        t_ref = tutor_ref(key, tutor_id)
        await gateway.archive_consent_evidence(tutor_id, t_ref, key.version)
        await gateway.archive_consent_evidence(tutor_id, t_ref, key.version)
        if not await gateway.consent_evidence_complete(tutor_id):
            raise AccountDeletionError("archive", "evidence_incomplete")
    except AccountDeletionError as exc:
        await _unfreeze(admin, tutor_id, frozen)
        raise exc from None
    except GatewayError as exc:
        await _unfreeze(admin, tutor_id, frozen)
        raise AccountDeletionError("archive", f"gateway_{exc.reason}") from None
    except AuthAdminError as exc:
        await _unfreeze(admin, tutor_id, frozen)
        raise AccountDeletionError("freeze", f"auth_{exc.reason}") from None

    # 5. Borrar (irreversible). Si falla, la evidencia ya está archivada: se puede reintentar.
    try:
        await admin.delete(tutor_id)
    except AuthAdminError as exc:
        # La evidencia ya está archivada (idempotente): se descongela para que la persona pueda
        # entrar y reintentar. El bloqueo corto (15 min) se levantaría solo de todos modos.
        await _unfreeze(admin, tutor_id, frozen)
        raise AccountDeletionError("delete", f"auth_{exc.reason}") from None

    # 6. Verificar.
    try:
        if await gateway.tutor_exists(tutor_id):
            raise AccountDeletionError("verify", "still_exists")
    except GatewayError as exc:
        raise AccountDeletionError("verify", f"gateway_{exc.reason}") from None
    # 7. Purgar el registro de auditoría de Auth (correo e IP del tutor). Mejor esfuerzo: la cuenta
    # ya está borrada; si falla se registra el código y queda como pendiente de limpieza.
    await _purge_audit(gateway, tutor_id, email)
    log_event(logger, "account.deleted", outcome="deleted")
    return "deleted"


async def _purge_audit(gateway: Gateway, tutor_id: uuid.UUID, email: str | None) -> None:
    """Borra el correo y la IP del tutor del registro de auditoría de Auth. Mejor esfuerzo."""
    try:
        await gateway.purge_auth_audit(tutor_id, email)
    except GatewayError as exc:
        log_event(logger, "account.audit_purge_failed", code=f"gateway_{exc.reason}")


async def _unfreeze(admin: AuthAdmin, tutor_id: uuid.UUID, frozen: bool) -> None:
    """Descongela la cuenta tras un fallo ANTES de borrar (mejor esfuerzo)."""
    if not frozen:
        return
    try:
        await admin.unban(tutor_id)
    except AuthAdminError as exc:
        log_event(logger, "account.unfreeze_failed", code=f"auth_{exc.reason}")
