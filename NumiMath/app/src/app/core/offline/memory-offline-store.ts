import {
  CachedProfile,
  OfflineBatch,
  OfflineOwner,
  PROFILES_TTL_SECONDS,
  QueuedAttempt,
  SYNC_GRACE_SECONDS,
} from './offline.model';
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
  cachedOwner: OfflineOwner | null = null;
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

  async removeAttempts(ids: string[]): Promise<void> {
    if (this.failWrites) throw this.failWrites;
    const drop = new Set(ids);
    this.dropAttempts((a) => drop.has(a.id));
  }

  async queuedStudents(): Promise<string[]> {
    return [...new Set(this.attempts.map((a) => a.studentId))];
  }

  async profiles(): Promise<CachedProfile[]> {
    return MemoryOfflineStore.copy(this.cachedProfiles);
  }

  async owner(): Promise<OfflineOwner | null> {
    return this.cachedOwner ? { ...this.cachedOwner } : null;
  }

  async saveProfiles(profiles: CachedProfile[], owner: OfflineOwner): Promise<void> {
    if (this.cachedOwner && this.cachedOwner.tutorId !== owner.tutorId) await this.clear();
    this.cachedProfiles = profiles.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      grade: p.grade,
      blocked: p.blocked,
      streakReminder: p.streakReminder === true,
    }));
    this.cachedOwner = { tutorId: owner.tutorId, savedAt: owner.savedAt };
    const active = new Set(profiles.filter((p) => !p.blocked).map((p) => p.id));
    for (const id of [...this.batches.keys()]) if (!active.has(id)) this.batches.delete(id);
    this.dropAttempts((a) => !active.has(a.studentId));
    this.notifyChange();
  }

  async forgetStudent(studentId: string): Promise<void> {
    this.batches.delete(studentId);
    this.cachedProfiles = this.cachedProfiles.filter((p) => p.id !== studentId);
    this.dropAttempts((a) => a.studentId === studentId);
    this.notifyChange();
  }

  async purgeExpired(nowS: number): Promise<void> {
    for (const [id, b] of this.batches) if (b.expiresAt <= nowS) this.batches.delete(id);
    this.dropAttempts((a) => a.expiresAt + SYNC_GRACE_SECONDS <= nowS);
    // Sin dueño (copia de una versión anterior) o con más de 7 días: fuera.
    if (!this.cachedOwner || this.cachedOwner.savedAt + PROFILES_TTL_SECONDS <= nowS) {
      this.cachedProfiles = [];
      this.cachedOwner = null;
    }
    this.notifyChange();
  }

  async clear(): Promise<void> {
    this.batches.clear();
    this.attempts.length = 0;
    this.cachedProfiles = [];
    this.cachedOwner = null;
    this.notifyChange();
  }

  private dropAttempts(drop: (a: QueuedAttempt) => boolean): void {
    const keep = this.attempts.filter((a) => !drop(a));
    this.attempts.length = 0;
    this.attempts.push(...keep);
  }
}
