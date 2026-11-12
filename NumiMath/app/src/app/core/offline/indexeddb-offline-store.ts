import { Injectable } from '@angular/core';

import { CachedProfile, OfflineBatch, QueuedAttempt, SYNC_GRACE_SECONDS } from './offline.model';
import { OfflineStore } from './offline-store.port';

const DB_NAME = 'numimath-offline';
const DB_VERSION = 1;
const BATCHES = 'batches';
const QUEUE = 'queue';
const PROFILES = 'profiles';

/**
 * IndexedDB nativo del navegador, sin librerías (ADR 0002): sirve igual en la PWA y dentro de
 * Capacitor. Las escrituras usan `durability: 'strict'` y se dan por hechas recién en
 * `oncomplete`, para que un intento no se pierda si la app se cierra justo después (RNF-06).
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbOfflineStore extends OfflineStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore(BATCHES, { keyPath: 'studentId' });
          db.createObjectStore(QUEUE, { keyPath: 'id' }).createIndex('studentId', 'studentId');
          db.createObjectStore(PROFILES, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch((error: unknown) => {
        this.db = null; // se puede reintentar más tarde
        throw error;
      });
      // Pedir almacenamiento persistente reduce el riesgo de que el navegador borre la cola
      // (ADR 0002, riesgos). Mejor esfuerzo: el navegador puede decir que no.
      void navigator.storage?.persist?.().catch(() => undefined);
    }
    return this.db;
  }

  /** Corre `work` en una transacción y se cumple cuando la transacción terminó de escribir. */
  private async tx<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => T | Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(stores, mode, { durability: 'strict' });
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('offline_store_aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('offline_store_error'));
    });
    const result = await work(tx);
    await done;
    return result;
  }

  private static read<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async batch(studentId: string): Promise<OfflineBatch | null> {
    return this.tx([BATCHES], 'readonly', async (tx) => {
      const found = await IndexedDbOfflineStore.read(tx.objectStore(BATCHES).get(studentId));
      return (found as OfflineBatch | undefined) ?? null;
    });
  }

  saveBatch(batch: OfflineBatch): Promise<void> {
    return this.tx([BATCHES], 'readwrite', (tx) => {
      tx.objectStore(BATCHES).put(batch);
    });
  }

  recordAttempt(batch: OfflineBatch, attempt: QueuedAttempt): Promise<void> {
    return this.tx([BATCHES, QUEUE], 'readwrite', (tx) => {
      tx.objectStore(QUEUE).add(attempt);
      tx.objectStore(BATCHES).put(batch);
    });
  }

  queue(studentId: string): Promise<QueuedAttempt[]> {
    return this.tx([QUEUE], 'readonly', (tx) =>
      IndexedDbOfflineStore.read(tx.objectStore(QUEUE).index('studentId').getAll(studentId)),
    ) as Promise<QueuedAttempt[]>;
  }

  profiles(): Promise<CachedProfile[]> {
    return this.tx([PROFILES], 'readonly', (tx) =>
      IndexedDbOfflineStore.read(tx.objectStore(PROFILES).getAll()),
    ) as Promise<CachedProfile[]>;
  }

  saveProfiles(profiles: CachedProfile[]): Promise<void> {
    return this.tx([PROFILES], 'readwrite', (tx) => {
      const store = tx.objectStore(PROFILES);
      // La lista reemplaza a la anterior: un perfil borrado en otro equipo desaparece también aquí.
      store.clear();
      // Solo apodo y curso (y si está en pausa): nada más del perfil.
      for (const p of profiles) {
        store.put({ id: p.id, nickname: p.nickname, grade: p.grade, blocked: p.blocked });
      }
    });
  }

  forgetStudent(studentId: string): Promise<void> {
    return this.tx([BATCHES, QUEUE, PROFILES], 'readwrite', async (tx) => {
      tx.objectStore(BATCHES).delete(studentId);
      tx.objectStore(PROFILES).delete(studentId);
      const queue = tx.objectStore(QUEUE);
      const keys = await IndexedDbOfflineStore.read(queue.index('studentId').getAllKeys(studentId));
      for (const key of keys) queue.delete(key);
    });
  }

  purgeExpired(nowS: number): Promise<void> {
    return this.tx([BATCHES, QUEUE], 'readwrite', async (tx) => {
      const batches = tx.objectStore(BATCHES);
      const allBatches = (await IndexedDbOfflineStore.read(batches.getAll())) as OfflineBatch[];
      for (const b of allBatches) if (b.expiresAt <= nowS) batches.delete(b.studentId);
      const queue = tx.objectStore(QUEUE);
      const attempts = (await IndexedDbOfflineStore.read(queue.getAll())) as QueuedAttempt[];
      for (const a of attempts) if (a.expiresAt + SYNC_GRACE_SECONDS <= nowS) queue.delete(a.id);
    });
  }

  clear(): Promise<void> {
    return this.tx([BATCHES, QUEUE, PROFILES], 'readwrite', (tx) => {
      tx.objectStore(BATCHES).clear();
      tx.objectStore(QUEUE).clear();
      tx.objectStore(PROFILES).clear();
    });
  }
}
