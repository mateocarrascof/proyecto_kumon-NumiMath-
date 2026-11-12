import { CachedProfile, OfflineBatch, QueuedAttempt } from './offline.model';

/** Almacenamiento local del modo sin conexión (CU-A12). Implementación: IndexedDB. */
export abstract class OfflineStore {
  abstract batch(studentId: string): Promise<OfflineBatch | null>;
  /** Guarda un lote nuevo: reemplaza el anterior del mismo perfil. */
  abstract saveBatch(batch: OfflineBatch): Promise<void>;
  /**
   * Guarda el intento en la cola y el lote actualizado (ejercicio usado, bloque) en UNA sola
   * transacción. La promesa se cumple solo cuando todo quedó escrito en disco (RNF-06): la
   * pantalla no muestra el resultado antes.
   */
  abstract recordAttempt(batch: OfflineBatch, attempt: QueuedAttempt): Promise<void>;
  abstract queue(studentId: string): Promise<QueuedAttempt[]>;
  abstract profiles(): Promise<CachedProfile[]>;
  abstract saveProfiles(profiles: CachedProfile[]): Promise<void>;
  /** Borra lote, cola y copia del perfil (perfil borrado, bloqueado o sin consentimiento). */
  abstract forgetStudent(studentId: string): Promise<void>;
  /** Borra lotes vencidos e intentos cuyo plazo para sincronizar ya pasó (`nowS` en segundos). */
  abstract purgeExpired(nowS: number): Promise<void>;
  /** Borra todo (al cerrar sesión o al revocar el consentimiento). */
  abstract clear(): Promise<void>;
}
