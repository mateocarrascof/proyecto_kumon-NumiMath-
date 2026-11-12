/**
 * Resultado de eliminar la cuenta:
 * `pin` = la confirmación fuerte (contraseña reciente) venció o falta;
 * `confirm` = no se escribió la palabra de confirmación;
 * `error` = el servidor no pudo completarlo (puede haber quedado a medias: se puede reintentar);
 * `network` = sin conexión o sin respuesta (no se sabe si se completó).
 */
export type DeleteAccountResult = 'ok' | 'pin' | 'confirm' | 'error' | 'network';

/** Palabra que hay que escribir para confirmar. El servidor la exige igual. */
export const DELETE_ACCOUNT_WORD = 'ELIMINAR';

/** Cuenta del tutor. Eliminar pasa por la API (orden del ADR 0001) y exige confirmación fuerte. */
export abstract class AccountPort {
  abstract delete(confirm: string): Promise<DeleteAccountResult>;
}
