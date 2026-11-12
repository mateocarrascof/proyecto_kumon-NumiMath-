import { CachedProfile, OfflineBatch, QueuedAttempt, SYNC_GRACE_SECONDS } from './offline.model';
import { OfflineStore } from './offline-store.port';

/**
 * Almacén en memoria con el mismo contrato que `IndexedDbOfflineStore`. Solo para pruebas (jsdom
 * no trae IndexedDB y no se agregan librerías para simularlo). Copia los datos al guardar y al
 * leer, como hace IndexedDB, para que una prueba no pueda "tocar" lo guardado por referencia.
 */
export class MemoryOfflineStore extends OfflineStore {
  readonly batches = new Map<string, OfflineBatch>();
  readonly attempts: QueuedAttempt[] = [];
  cachedProfiles: CachedProfile[] = [];
  /** Si se define, `recordAttempt` falla con este error (para probar "no se pudo guardar"). */
  failWrites: Error | null = null;

  private static copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  async batch(studentId: string): Promise<OfflineBatch | null> {
    const found = this.batches.get(studentId);
    return found ? MemoryOfflineStore.copy(found) : null;
  }

  async saveBatch(batch: OfflineBatch): Promise<void> {
    this.batches.set(batch.studentId, MemoryOfflineStore.copy(batch));
  }

  async recordAttempt(batch: OfflineBatch, attempt: QueuedAttempt): Promise<void> {
    if (this.failWrites) throw this.failWrites;
    this.attempts.push(MemoryOfflineStore.copy(attempt));
    this.batches.set(batch.studentId, MemoryOfflineStore.copy(batch));
  }

  async queue(studentId: string): Promise<QueuedAttempt[]> {
    return this.attempts.filter((a) => a.studentId === studentId).map(MemoryOfflineStore.copy);
  }

  async profiles(): Promise<CachedProfile[]> {
    return MemoryOfflineStore.copy(this.cachedProfiles);
  }

  async saveProfiles(profiles: CachedProfile[]): Promise<void> {
    this.cachedProfiles = profiles.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      grade: p.grade,
      blocked: p.blocked,
    }));
  }

  async forgetStudent(studentId: string): Promise<void> {
    this.batches.delete(studentId);
    this.cachedProfiles = this.cachedProfiles.filter((p) => p.id !== studentId);
    this.removeAttempts((a) => a.studentId === studentId);
  }

  async purgeExpired(nowS: number): Promise<void> {
    for (const [id, b] of this.batches) if (b.expiresAt <= nowS) this.batches.delete(id);
    this.removeAttempts((a) => a.expiresAt + SYNC_GRACE_SECONDS <= nowS);
  }

  async clear(): Promise<void> {
    this.batches.clear();
    this.attempts.length = 0;
    this.cachedProfiles = [];
  }

  private removeAttempts(drop: (a: QueuedAttempt) => boolean): void {
    const keep = this.attempts.filter((a) => !drop(a));
    this.attempts.length = 0;
    this.attempts.push(...keep);
  }
}
