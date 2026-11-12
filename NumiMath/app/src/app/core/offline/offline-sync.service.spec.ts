import { TestBed } from '@angular/core/testing';

import { ConnectivityService } from './connectivity.service';
import { MemoryOfflineStore } from './memory-offline-store';
import { QueuedAttempt } from './offline.model';
import { OfflineStore } from './offline-store.port';
import { OfflineSyncError, OfflineSyncPort, SyncResult } from './offline-sync.port';
import {
  OfflineSyncService,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SYNC_CHUNK,
  retryDelayMs,
} from './offline-sync.service';

const ID = 'perfil-1';

/** Intento n de la cola: hora creciente con n (n = 0 es el más antiguo). */
function attempt(n: number, studentId = ID): QueuedAttempt {
  const at = new Date(Date.UTC(2026, 10, 12, 10, 0, n)).toISOString();
  return {
    id: `a-${String(n).padStart(3, '0')}`,
    studentId,
    token: `tok-${n}`,
    topic: '2-06',
    level: 1,
    answer: n,
    correct: true,
    answeredAt: at,
    localDate: '2026-11-12',
    durationS: 10,
    expiresAt: 2_000_000_000,
  };
}

type Send = (studentId: string, attempts: QueuedAttempt[]) => Promise<SyncResult[]>;

const accepted: Send = async (_s, attempts) => attempts.map((a) => ({ id: a.id, status: 'accepted' }));

function setup(send: Send = accepted, store = new MemoryOfflineStore()) {
  const port = { send: vi.fn(send) };
  TestBed.configureTestingModule({
    providers: [
      { provide: OfflineStore, useValue: store },
      { provide: OfflineSyncPort, useValue: port },
    ],
  });
  const service = TestBed.inject(OfflineSyncService);
  service.wait = vi.fn(async () => undefined);
  // Sin azar en las pruebas: espera completa y sin demora al volver la red.
  service.random = () => 1;
  return { service, store, port };
}

describe('OfflineSyncService (CU-A13)', () => {
  afterEach(() => vi.useRealTimers());

  it('éxito: envía la cola y la limpia', async () => {
    const { service, store, port } = setup();
    store.attempts.push(attempt(1), attempt(2));
    expect(await service.sync(ID)).toBe('done');
    expect(port.send).toHaveBeenCalledTimes(1);
    expect(await store.queue(ID)).toEqual([]);
  });

  it('cola vacía: no llama al servidor', async () => {
    const { service, port } = setup();
    expect(await service.sync(ID)).toBe('done');
    expect(port.send).not.toHaveBeenCalled();
  });

  it('duplicados y rechazados definitivos también salen de la cola', async () => {
    const { service, store } = setup(async (_s, a) => [
      { id: a[0].id, status: 'duplicate' },
      { id: a[1].id, status: 'rejected' },
    ]);
    store.attempts.push(attempt(1), attempt(2));
    expect(await service.sync(ID)).toBe('done');
    expect(await store.queue(ID)).toEqual([]);
  });

  it('más de 15 intentos: varios lotes, uno tras otro, del más antiguo al más nuevo, con pausa', async () => {
    const { service, store, port } = setup();
    // 40 intentos guardados DESORDENADOS.
    for (const n of [...Array(40).keys()].reverse()) store.attempts.push(attempt(n));
    expect(await service.sync(ID)).toBe('done');
    expect(port.send).toHaveBeenCalledTimes(3);
    const sizes = port.send.mock.calls.map(([, a]) => a.length);
    expect(sizes).toEqual([SYNC_CHUNK, SYNC_CHUNK, 10]);
    const order = port.send.mock.calls.flatMap(([, a]) => a.map((x) => x.answer));
    expect(order).toEqual([...Array(40).keys()]);
    // Pausa ENTRE lotes (no antes del primero).
    expect(service.wait).toHaveBeenCalledTimes(2);
    expect(await store.queue(ID)).toEqual([]);
  });

  it('nunca manda dos lotes del mismo perfil a la vez', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { service, store } = setup(async (_s, a) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return a.map((x) => ({ id: x.id, status: 'accepted' as const }));
    });
    for (let n = 0; n < 31; n++) store.attempts.push(attempt(n));
    await service.sync(ID);
    expect(maxInFlight).toBe(1);
  });

  it('falla a mitad: se detiene sin saltarse lotes y reanuda desde donde quedó', async () => {
    let calls = 0;
    const { service, store, port } = setup(async (_s, a) => {
      calls++;
      if (calls === 2) throw new OfflineSyncError('retry'); // 5xx o 429 en el segundo lote
      return a.map((x) => ({ id: x.id, status: 'accepted' as const }));
    });
    for (let n = 0; n < 40; n++) store.attempts.push(attempt(n));
    expect(await service.sync(ID)).toBe('pending');
    // Se confirmó solo el primer lote; el tercero NO se envió.
    expect(port.send).toHaveBeenCalledTimes(2);
    expect((await store.queue(ID)).map((a) => a.answer)).toEqual([...Array(25).keys()].map((n) => n + 15));
    // Reanuda: empieza por el lote que falló.
    expect(await service.sync(ID)).toBe('done');
    expect(port.send.mock.calls[2][1].map((a) => a.answer)).toEqual(
      [...Array(15).keys()].map((n) => n + 15),
    );
    expect(await store.queue(ID)).toEqual([]);
  });

  it('sin red: los intentos quedan en cola y se marca sin conexión', async () => {
    const { service, store } = setup(async () => {
      throw new OfflineSyncError('network');
    });
    store.attempts.push(attempt(1));
    expect(await service.sync(ID)).toBe('pending');
    expect(await store.queue(ID)).toHaveLength(1);
    expect(TestBed.inject(ConnectivityService).online()).toBe(false);
  });

  it('reintenta con espera creciente (2 s, 4 s, 8 s…) hasta que funciona', async () => {
    vi.useFakeTimers();
    let fails = 3;
    const { service, store, port } = setup(async (_s, a) => {
      if (fails-- > 0) throw new OfflineSyncError('retry');
      return a.map((x) => ({ id: x.id, status: 'accepted' as const }));
    });
    store.attempts.push(attempt(1));
    expect(await service.sync(ID)).toBe('pending');
    expect(service.retryScheduled(ID)).toBe(1);
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS - 1);
    expect(port.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // 2 s
    expect(port.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * RETRY_BASE_MS); // 4 s
    expect(port.send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4 * RETRY_BASE_MS); // 8 s: ahora funciona
    expect(port.send).toHaveBeenCalledTimes(4);
    expect(await store.queue(ID)).toEqual([]);
    expect(service.retryScheduled(ID)).toBeNull();
  });

  it('la espera tiene tope de 5 minutos', () => {
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(20)).toBe(RETRY_MAX_MS);
  });

  it('perfil bloqueado o borrado (403/404): definitivo, borra lo suyo y no reintenta', async () => {
    const { service, store } = setup(async () => {
      throw new OfflineSyncError('forbidden');
    });
    store.attempts.push(attempt(1), attempt(2, 'otro-perfil'));
    expect(await service.sync(ID)).toBe('forbidden');
    expect(await store.queue(ID)).toEqual([]);
    expect(await store.queue('otro-perfil')).toHaveLength(1);
    expect(service.retryScheduled(ID)).toBeNull();
  });

  it('si el servidor no responde por todos los del lote, no sigue con el siguiente', async () => {
    const { service, store, port } = setup(async (_s, a) => [{ id: a[0].id, status: 'accepted' }]);
    for (let n = 0; n < 20; n++) store.attempts.push(attempt(n));
    expect(await service.sync(ID)).toBe('pending');
    expect(port.send).toHaveBeenCalledTimes(1);
    expect(await store.queue(ID)).toHaveLength(19);
  });

  it('no borra intentos que el servidor no envió en este lote (ids ajenos)', async () => {
    const { service, store } = setup(async () => [{ id: 'a-999', status: 'accepted' }]);
    store.attempts.push(attempt(1), attempt(999, 'otro-perfil'));
    await service.sync(ID);
    expect(await store.queue('otro-perfil')).toHaveLength(1);
  });

  it('candado: dos disparadores a la vez comparten una sola sincronización', async () => {
    const { service, store, port } = setup();
    store.attempts.push(attempt(1));
    const [a, b] = await Promise.all([service.sync(ID), service.sync(ID)]);
    expect([a, b]).toEqual(['done', 'done']);
    expect(port.send).toHaveBeenCalledTimes(1);
  });

  it('syncAll sincroniza cada perfil con cola, uno tras otro', async () => {
    const { service, store, port } = setup();
    store.attempts.push(attempt(1, 'p-a'), attempt(2, 'p-b'));
    await service.syncAll();
    expect(port.send.mock.calls.map(([id]) => id).sort()).toEqual(['p-a', 'p-b']);
    expect(store.attempts).toEqual([]);
  });

  it('al volver la red (evento online) sincroniza', async () => {
    const { service, store, port } = setup();
    store.attempts.push(attempt(1));
    service.random = () => 0;
    const target = new EventTarget() as unknown as Window;
    service.listenForReconnect(target);
    target.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(port.send).toHaveBeenCalledTimes(1));
  });

  it('al volver la red espera entre 0 y 2 s al azar (no todos los equipos a la vez)', async () => {
    vi.useFakeTimers();
    const { service, store, port } = setup();
    store.attempts.push(attempt(1));
    service.random = () => 0.5;
    const target = new EventTarget() as unknown as Window;
    service.listenForReconnect(target);
    target.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(999);
    expect(port.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(port.send).toHaveBeenCalledTimes(1);
  });

  it('los reintentos se reparten al azar entre la mitad y el total de la espera', async () => {
    vi.useFakeTimers();
    const { service, store, port } = setup(async () => {
      throw new OfflineSyncError('retry');
    });
    service.random = () => 0; // la mitad: 1 s en vez de 2 s
    store.attempts.push(attempt(1));
    await service.sync(ID);
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS / 2 - 1);
    expect(port.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(port.send).toHaveBeenCalledTimes(2);
  });

  it('syncWithin: si no termina a tiempo devuelve pending y la sincronización sigue', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const { service, store } = setup(
      (_s, a) =>
        new Promise((resolve) => {
          release = () => resolve(a.map((x) => ({ id: x.id, status: 'accepted' as const })));
        }),
    );
    store.attempts.push(attempt(1));
    const outcome = service.syncWithin(ID, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await outcome).toBe('pending');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(await store.queue(ID)).toEqual([]);
  });

  it('syncWithin: si termina antes, devuelve el resultado real', async () => {
    const { service, store } = setup();
    store.attempts.push(attempt(1));
    expect(await service.syncWithin(ID, 3000)).toBe('done');
  });
});
