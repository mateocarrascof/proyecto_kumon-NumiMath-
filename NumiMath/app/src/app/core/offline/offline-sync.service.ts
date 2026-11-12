import { Injectable, inject } from '@angular/core';

import { ConnectivityService } from './connectivity.service';
import { QueuedAttempt } from './offline.model';
import { OfflineStore } from './offline-store.port';
import { OfflineSyncError, OfflineSyncPort } from './offline-sync.port';

/** Intentos por petición: el servidor acepta 15 (tope de 8 KB por cuerpo). */
export const SYNC_CHUNK = 15;
/** Pausa entre lotes de un mismo perfil, para no chocar con el límite de peticiones. */
export const SYNC_PAUSE_MS = 300;
/** Espera creciente tras una falla temporal: 2 s, 4 s, 8 s… hasta 5 minutos. */
export const RETRY_BASE_MS = 2000;
export const RETRY_MAX_MS = 5 * 60 * 1000;
/** Al volver la red se espera entre 0 y 2 s antes de enviar (ver `listenForReconnect`). */
export const RECONNECT_SPREAD_MS = 2000;

/**
 * `done`: la cola del perfil quedó vacía. `pending`: falló algo temporal; lo que no se confirmó
 * sigue en la cola y hay un reintento programado. `forbidden`: el perfil ya no existe o está
 * bloqueado; se borró lo suyo del dispositivo.
 */
export type SyncOutcome = 'done' | 'pending' | 'forbidden';

export function retryDelayMs(failures: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}

/**
 * CU-A13: envía la cola de intentos hechos sin conexión.
 *
 * Por qué así:
 * - Los lotes de un perfil van UNO TRAS OTRO, del más antiguo al más nuevo, esperando la respuesta
 *   de cada uno: el servidor recalcula nivel y racha en orden cronológico y no debe recibir un
 *   intento nuevo antes que uno viejo.
 * - Si un lote falla por algo temporal, se detiene ese perfil (no se salta lotes) y se reintenta
 *   más tarde desde el que falló, con espera creciente.
 * - Un candado por perfil: dos disparadores a la vez (volvió la red y se abrió la práctica)
 *   comparten la misma sincronización.
 * - Los intentos solo salen de la cola cuando el servidor respondió por ellos.
 */
@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly store = inject(OfflineStore);
  private readonly port = inject(OfflineSyncPort);
  private readonly connectivity = inject(ConnectivityService);
  private readonly running = new Map<string, Promise<SyncOutcome>>();
  private readonly retries = new Map<
    string,
    { failures: number; timer: ReturnType<typeof setTimeout> }
  >();
  private listening = false;

  /** Pausa entre lotes (las pruebas la cambian). */
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Azar para repartir los reintentos (las pruebas lo fijan). */
  random: () => number = Math.random;

  /**
   * Sincroniza, pero espera como máximo `ms`. Si no alcanza, devuelve `pending` y la
   * sincronización SIGUE en segundo plano. Para que la práctica no quede esperando una cola larga
   * o una red lenta (decisión del dueño: máx. 3 s antes de mostrar los temas).
   */
  syncWithin(studentId: string, ms: number): Promise<SyncOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<SyncOutcome>((resolve) => {
      timer = setTimeout(() => resolve('pending'), ms);
    });
    return Promise.race([this.sync(studentId), limit]).finally(() => clearTimeout(timer));
  }

  /** Sincroniza un perfil. Si ya hay una sincronización de ese perfil en curso, la comparte. */
  sync(studentId: string): Promise<SyncOutcome> {
    const current = this.running.get(studentId);
    if (current) return current;
    const work = this.run(studentId).finally(() => this.running.delete(studentId));
    this.running.set(studentId, work);
    return work;
  }

  /** Sincroniza todos los perfiles con intentos en cola, uno tras otro. */
  async syncAll(): Promise<void> {
    const ids = await this.store.queuedStudents().catch(() => [] as string[]);
    for (const id of ids) await this.sync(id);
  }

  /** Al volver la red (evento del navegador), se sincroniza. Se registra una sola vez. */
  listenForReconnect(target: Window | undefined = typeof window === 'undefined' ? undefined : window): void {
    if (this.listening || !target) return;
    this.listening = true;
    // Entre 0 y 2 s al azar: si muchos equipos recuperan la red a la vez (un colegio entero), no
    // llegan todos al servidor en el mismo instante.
    target.addEventListener('online', () => {
      setTimeout(() => void this.syncAll(), this.random() * RECONNECT_SPREAD_MS);
    });
  }

  /** ¿Hay un reintento programado para el perfil? (para pruebas y diagnóstico). */
  retryScheduled(studentId: string): number | null {
    return this.retries.get(studentId)?.failures ?? null;
  }

  private async run(studentId: string): Promise<SyncOutcome> {
    let queue: QueuedAttempt[];
    try {
      queue = await this.store.queue(studentId);
    } catch {
      return this.fail(studentId);
    }
    // Del más antiguo al más nuevo (a igual hora, por id, para que el orden sea siempre el mismo).
    queue.sort((a, b) =>
      a.answeredAt === b.answeredAt ? a.id.localeCompare(b.id) : a.answeredAt < b.answeredAt ? -1 : 1,
    );
    for (let i = 0; i < queue.length; i += SYNC_CHUNK) {
      if (i > 0) await this.wait(SYNC_PAUSE_MS);
      const chunk = queue.slice(i, i + SYNC_CHUNK);
      let confirmed: string[];
      try {
        const results = await this.port.send(studentId, chunk);
        const sent = new Set(chunk.map((a) => a.id));
        confirmed = [...new Set(results.map((r) => r.id).filter((id) => sent.has(id)))];
      } catch (error) {
        if (error instanceof OfflineSyncError && error.code === 'forbidden') {
          // Perfil bloqueado o borrado: definitivo. Se borra lo suyo (lote, cola y copia).
          this.clearRetry(studentId);
          await this.store.forgetStudent(studentId).catch(() => undefined);
          return 'forbidden';
        }
        if (error instanceof OfflineSyncError && error.code === 'network') {
          this.connectivity.reportNetworkFailure();
        }
        return this.fail(studentId);
      }
      try {
        await this.store.removeAttempts(confirmed);
      } catch {
        return this.fail(studentId);
      }
      this.connectivity.reportSuccess();
      // Si el servidor no respondió por todos, no se sigue: el orden importa.
      if (confirmed.length < chunk.length) return this.fail(studentId);
    }
    this.clearRetry(studentId);
    return 'done';
  }

  private fail(studentId: string): SyncOutcome {
    const previous = this.retries.get(studentId);
    if (previous) clearTimeout(previous.timer);
    const failures = (previous?.failures ?? 0) + 1;
    // Entre la mitad y el total de la espera creciente, al azar: tras una caída del servidor los
    // equipos no reintentan todos juntos (sigue dentro del rango acordado de 2 s a 5 min).
    const delay = retryDelayMs(failures) * (0.5 + 0.5 * this.random());
    const timer = setTimeout(() => void this.sync(studentId), delay);
    this.retries.set(studentId, { failures, timer });
    return 'pending';
  }

  private clearRetry(studentId: string): void {
    const previous = this.retries.get(studentId);
    if (previous) clearTimeout(previous.timer);
    this.retries.delete(studentId);
  }
}
