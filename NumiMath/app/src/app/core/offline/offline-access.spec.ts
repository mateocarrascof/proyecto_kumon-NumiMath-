import { MemoryOfflineStore } from './memory-offline-store';
import { PROFILES_TTL_SECONDS } from './offline.model';
import { offlineAllowed } from './offline-access';

const NOW_S = 1_800_000_000;
const ANA = { id: 'p-ana', nickname: 'Ana', grade: 2 as const, blocked: false };
const BETO = { id: 'p-beto', nickname: 'Beto', grade: 3 as const, blocked: true };

async function storeWith(savedAt = NOW_S) {
  const store = new MemoryOfflineStore();
  await store.saveProfiles([ANA, BETO], { tutorId: 'tutor-1', savedAt });
  return store;
}

const route = (params: Record<string, string> = {}, offline = true) =>
  ({ data: offline ? { offline: true } : {}, params }) as never;

describe('offlineAllowed (CU-A12)', () => {
  it('acepta una ruta de práctica con copia vigente', async () => {
    expect(await offlineAllowed(route(), await storeWith(), NOW_S)).toBe(true);
  });

  it('no acepta rutas sin `offline: true`', async () => {
    expect(await offlineAllowed(route({}, false), await storeWith(), NOW_S)).toBe(false);
  });

  it('la copia vence a los 7 días de la última carga con conexión', async () => {
    const store = await storeWith(NOW_S - PROFILES_TTL_SECONDS);
    expect(await offlineAllowed(route(), store, NOW_S)).toBe(false);
  });

  it('sin dueño registrado (copia antigua o borrada) no deja pasar', async () => {
    const store = await storeWith();
    store.cachedOwner = null;
    expect(await offlineAllowed(route(), store, NOW_S)).toBe(false);
  });

  it('/practica/:id: el perfil debe estar en la copia', async () => {
    const store = await storeWith();
    expect(await offlineAllowed(route({ id: 'p-ana' }), store, NOW_S)).toBe(true);
    expect(await offlineAllowed(route({ id: 'perfil-ajeno' }), store, NOW_S)).toBe(false);
  });

  it('/practica/:id: un perfil en pausa no se abre aunque se escriba la dirección', async () => {
    expect(await offlineAllowed(route({ id: 'p-beto' }), await storeWith(), NOW_S)).toBe(false);
  });
});

describe('MemoryOfflineStore: copia ligada al tutor (CU-A12)', () => {
  const batch = (studentId: string) => ({
    studentId, salt: 's', issuedAt: NOW_S, expiresAt: NOW_S + 3600, topics: [], exercises: [],
  });
  const attempt = (studentId: string) => ({
    id: `a-${studentId}`, studentId, token: 't', topic: '2-06', level: 1 as const, answer: 1,
    correct: true, answeredAt: '', localDate: '2026-11-12', durationS: null, expiresAt: NOW_S,
  });

  it('si entra otro tutor, no queda nada del anterior', async () => {
    const store = await storeWith();
    await store.saveBatch(batch('p-ana'));
    store.attempts.push(attempt('p-ana'));
    await store.saveProfiles([{ ...ANA, id: 'p-otro' }], { tutorId: 'tutor-2', savedAt: NOW_S });
    expect(await store.batch('p-ana')).toBeNull();
    expect(store.attempts).toEqual([]);
    expect((await store.owner())?.tutorId).toBe('tutor-2');
  });

  it('al recargar la lista, se borran lote y cola de perfiles borrados o en pausa', async () => {
    const store = await storeWith();
    for (const id of ['p-ana', 'p-beto', 'p-borrado']) {
      await store.saveBatch(batch(id));
      store.attempts.push(attempt(id));
    }
    await store.saveProfiles([ANA, BETO], { tutorId: 'tutor-1', savedAt: NOW_S });
    expect(await store.batch('p-ana')).not.toBeNull();
    expect(await store.batch('p-beto')).toBeNull();
    expect(await store.batch('p-borrado')).toBeNull();
    expect(store.attempts.map((a) => a.studentId)).toEqual(['p-ana']);
  });

  it('purgeExpired borra la copia de perfiles con más de 7 días', async () => {
    const store = await storeWith(NOW_S - PROFILES_TTL_SECONDS);
    await store.purgeExpired(NOW_S);
    expect(await store.profiles()).toEqual([]);
    expect(await store.owner()).toBeNull();
  });
});
