import { Injectable } from '@angular/core';

import {
  CachedProfile,
  OfflineBatch,
  OfflineOwner,
  PROFILES_TTL_SECONDS,
  QueuedAttempt,
  SYNC_GRACE_SECONDS,
} from './offline.model';
import { OfflineStore } from './offline-store.port';

const DB_NAME = 'numimath-offline';
// Versión 2: almacén `meta` con el dueño de la copia (tutor y fecha). Se crea solo lo que falta,
// para no perder datos de un equipo que ya tuviera la versión 1.
const DB_VERSION = 2;
const BATCHES = 'batches';
const QUEUE = 'queue';
const PROFILES = 'profiles';
const META = 'meta';
const OWNER_KEY = 'owner';
const ALL = [BATCHES, QUEUE, PROFILES, META];

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
          const has = (name: string) => db.objectStoreNames.contains(name);
          if (!has(BATCHES)) db.createObjectStore(BATCHES, { keyPath: 'studentId' });
          if (!has(QUEUE)) {
            db.createObjectStore(QUEUE, { keyPath: 'id' }).createIndex('studentId', 'studentId');
          }
          if (!has(PROFILES)) db.createObjectStore(PROFILES, { keyPath: 'id' });
          if (!has(META)) db.createObjectStore(META);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch((error: unknown) => {
        this.db = null; // se puede reintentar más tarde
        throw error;
      });
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

  owner(): Promise<OfflineOwner | null> {
    return this.tx([META], 'readonly', async (tx) => {
      const found = await IndexedDbOfflineStore.read(tx.objectStore(META).get(OWNER_KEY));
      return (found as OfflineOwner | undefined) ?? null;
    });
  }

  saveProfiles(profiles: CachedProfile[], owner: OfflineOwner): Promise<void> {
    return this.tx(ALL, 'readwrite', async (tx) => {
      const meta = tx.objectStore(META);
      const previous = (await IndexedDbOfflineStore.read(meta.get(OWNER_KEY))) as
        | OfflineOwner
        | undefined;
      const batches = tx.objectStore(BATCHES);
      const queue = tx.objectStore(QUEUE);
      // Otro tutor en el mismo equipo: no queda nada del anterior.
      if (previous && previous.tutorId !== owner.tutorId) {
        batches.clear();
        queue.clear();
      }
      const store = tx.objectStore(PROFILES);
      // La lista reemplaza a la anterior: un perfil borrado en otro equipo desaparece también aquí.
      store.clear();
      // Solo apodo y curso (y si está en pausa): nada más del perfil.
      for (const p of profiles) {
        store.put({ id: p.id, nickname: p.nickname, grade: p.grade, blocked: p.blocked });
      }
      meta.put({ tutorId: owner.tutorId, savedAt: owner.savedAt }, OWNER_KEY);
      // Perfiles borrados o en pausa: fuera su lote y su cola.
      const active = new Set(profiles.filter((p) => !p.blocked).map((p) => p.id));
      const batchKeys = await IndexedDbOfflineStore.read(batches.getAllKeys());
      for (const key of batchKeys) if (!active.has(String(key))) batches.delete(key);
      const attempts = (await IndexedDbOfflineStore.read(queue.getAll())) as QueuedAttempt[];
      for (const a of attempts) if (!active.has(a.studentId)) queue.delete(a.id);
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
    return this.tx(ALL, 'readwrite', async (tx) => {
      const batches = tx.objectStore(BATCHES);
      const allBatches = (await IndexedDbOfflineStore.read(batches.getAll())) as OfflineBatch[];
      for (const b of allBatches) if (b.expiresAt <= nowS) batches.delete(b.studentId);
      const queue = tx.objectStore(QUEUE);
      const attempts = (await IndexedDbOfflineStore.read(queue.getAll())) as QueuedAttempt[];
      for (const a of attempts) if (a.expiresAt + SYNC_GRACE_SECONDS <= nowS) queue.delete(a.id);
      const meta = tx.objectStore(META);
      const owner = (await IndexedDbOfflineStore.read(meta.get(OWNER_KEY))) as
        | OfflineOwner
        | undefined;
      // Sin dueño (copia de una versión anterior) o con más de 7 días: fuera.
      if (!owner || owner.savedAt + PROFILES_TTL_SECONDS <= nowS) {
        tx.objectStore(PROFILES).clear();
        meta.delete(OWNER_KEY);
      }
    });
  }

  clear(): Promise<void> {
    return this.tx(ALL, 'readwrite', (tx) => {
      for (const name of ALL) tx.objectStore(name).clear();
    });
  }
}
