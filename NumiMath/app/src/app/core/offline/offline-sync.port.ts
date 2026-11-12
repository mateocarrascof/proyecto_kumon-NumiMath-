import { QueuedAttempt } from './offline.model';

/**
 * Resultado del servidor por intento (CU-A13). Los tres son DEFINITIVOS: el intento sale de la
 * cola. `accepted`: registrado ahora. `duplicate`: ya estaba (reenvío). `rejected`: no se
 * registrará nunca (token inválido o vencido tras el margen de 14 días).
 */
export type SyncStatus = 'accepted' | 'duplicate' | 'rejected';

export interface SyncResult {
  id: string;
  status: SyncStatus;
}

/**
 * `forbidden`: el perfil está bloqueado o se borró (403/404): definitivo, se borra lo suyo del
 * dispositivo. `network` (sin red) y `retry` (5xx, 429, sesión o respuesta rara): temporales, los
 * intentos quedan en la cola y se reintenta con espera creciente.
 */
export type OfflineSyncErrorCode = 'forbidden' | 'network' | 'retry';

export class OfflineSyncError extends Error {
  constructor(readonly code: OfflineSyncErrorCode) {
    super(code);
  }
}

/** Envío de un lote de intentos sin conexión de UN perfil (FastAPI, con el JWT del tutor). */
export abstract class OfflineSyncPort {
  abstract send(studentId: string, attempts: QueuedAttempt[]): Promise<SyncResult[]>;
}
