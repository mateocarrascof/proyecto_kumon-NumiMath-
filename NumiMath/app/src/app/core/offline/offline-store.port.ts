import { CachedProfile, OfflineBatch, OfflineOwner, QueuedAttempt } from './offline.model';

/** Almacenamiento local del modo sin conexión (CU-A12). Implementación: IndexedDB. */
export abstract class OfflineStore {
  private readonly listeners: (() => void)[] = [];

  /**
   * CU-A9: avisa cuando cambia lo guardado (cerrar sesión, revocar, otro tutor, borrar o pausar un
   * perfil, purga). El recordatorio de racha se reprograma o se cancela según lo que quede.
   */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  protected notifyChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Un oyente que falla no debe romper el guardado.
      }
    }
  }

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
  /** Quita de la cola los intentos que el servidor ya confirmó (CU-A13). */
  abstract removeAttempts(ids: string[]): Promise<void>;
  /** Perfiles con intentos en cola (para sincronizar todos al volver la red). */
  abstract queuedStudents(): Promise<string[]>;
  abstract profiles(): Promise<CachedProfile[]>;
  /** Tutor dueño de la copia local y cuándo se guardó (null si no hay copia). */
  abstract owner(): Promise<OfflineOwner | null>;
  /**
   * Reemplaza la copia de perfiles (leída con conexión) y anota su dueño. Si el dueño cambió,
   * borra antes todo lo del tutor anterior. Además borra lote y cola de los perfiles que ya no
   * están o están en pausa (borrados o bloqueados desde otro equipo).
   */
  abstract saveProfiles(profiles: CachedProfile[], owner: OfflineOwner): Promise<void>;
  /** Borra lote, cola y copia del perfil (perfil borrado, bloqueado o sin consentimiento). */
  abstract forgetStudent(studentId: string): Promise<void>;
  /**
   * Borra lotes vencidos, intentos cuyo plazo para sincronizar ya pasó y la copia de perfiles si
   * tiene más de 7 días (`nowS` en segundos).
   */
  abstract purgeExpired(nowS: number): Promise<void>;
  /** Borra todo (al cerrar sesión o al revocar el consentimiento). */
  abstract clear(): Promise<void>;
}
