/** La constancia de la revocación, tal como la devuelve el servidor (fechas en UTC, ISO 8601). */
export interface RevocationReceipt {
  /** Fecha-hora de la revocación: es la constancia. */
  revokedAt: string;
  /** Ya estaba revocado antes: se muestra la fecha original. */
  alreadyRevoked: boolean;
  profilesBlocked: number;
  /** Plazo (provisional) tras el cual se borran los perfiles bloqueados; null si no hay perfiles. */
  purgeAfterDays: number | null;
  purgeAt: string | null;
}

/**
 * Resultado de revocar:
 * `pin` = falta el PIN o venció; `no_consent` = nunca había aceptado;
 * `error` = el servidor no pudo confirmarlo (puede que sí se haya hecho);
 * `network` = sin conexión o sin respuesta (no se sabe si se hizo).
 */
export type RevokeConsentResult =
  | { ok: true; receipt: RevocationReceipt }
  | { ok: false; reason: 'pin' | 'no_consent' | 'error' | 'network' };

/** Revocar el consentimiento del tutor (zona del tutor, con el PIN). Pasa por la API. */
export abstract class ConsentRevocationPort {
  abstract revoke(): Promise<RevokeConsentResult>;
}
