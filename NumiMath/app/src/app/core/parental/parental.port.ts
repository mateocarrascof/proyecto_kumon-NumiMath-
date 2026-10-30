export interface PinStatus {
  hasPin: boolean;
  /** ISO, si está bloqueado por demasiados intentos. */
  lockedUntil: string | null;
}

export type PinErrorCode =
  | 'wrong'
  | 'locked'
  | 'not_set'
  | 'weak'
  | 'format'
  | 'reauth_required'
  | 'session'
  | 'unavailable'
  | 'network';

export class PinError extends Error {
  constructor(
    readonly code: PinErrorCode,
    /** Intentos que quedan (solo en `wrong`). */
    readonly remaining: number | null = null,
    readonly serverMessage = '',
  ) {
    super(code);
  }
}

/** PIN del tutor. El hash, los intentos y el bloqueo viven en el servidor. */
export abstract class ParentalPort {
  abstract status(): Promise<PinStatus>;
  /** Verifica el PIN y guarda el token parental en la sesión. */
  abstract verify(pin: string): Promise<void>;
  /** Crea o cambia el PIN (y queda desbloqueado). */
  abstract set(pin: string): Promise<void>;
}
