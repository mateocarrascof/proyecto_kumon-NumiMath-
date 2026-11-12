import { OfflineBatch } from './offline.model';

/**
 * `forbidden`: el perfil ya no es usable (borrado, bloqueado o sin consentimiento): se borran
 * sus datos locales. `limit`: ya hubo 5 descargas hoy. El resto: reintentar más tarde.
 */
export type OfflineBatchErrorCode = 'forbidden' | 'limit' | 'session' | 'network' | 'unavailable';

export class OfflineBatchError extends Error {
  constructor(readonly code: OfflineBatchErrorCode) {
    super(code);
  }
}

/** Descarga del lote para practicar sin conexión (FastAPI, con el JWT del tutor). */
export abstract class OfflineBatchPort {
  abstract download(studentId: string): Promise<OfflineBatch>;
}
