import { MemoryOfflineStore } from './memory-offline-store';
import { PROFILES_TTL_SECONDS } from './offline.model';
import { startOfflinePurge } from './offline-purge';

const NOW_S = 1_800_000_000;
const ANA = { id: 'p-ana', nickname: 'Ana', grade: 2 as const, blocked: false };

async function expiredStore() {
  const store = new MemoryOfflineStore();
  await store.saveProfiles([ANA], { tutorId: 't', savedAt: NOW_S - PROFILES_TTL_SECONDS });
  await store.saveBatch({
    studentId: 'p-ana', salt: 's', issuedAt: NOW_S - 8 * 86400, expiresAt: NOW_S - 86400,
    topics: [], exercises: [],
  });
  return store;
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('startOfflinePurge (CU-A12)', () => {
  it('al iniciar la app borra lo vencido, sin red', async () => {
    const store = await expiredStore();
    const stop = startOfflinePurge(store, () => NOW_S * 1000);
    await settle();
    expect(await store.profiles()).toEqual([]);
    expect(await store.owner()).toBeNull();
    expect(await store.batch('p-ana')).toBeNull();
    stop();
  });

  it('al volver a primer plano vuelve a purgar (la app casi nunca se cierra del todo)', async () => {
    const store = new MemoryOfflineStore();
    let clock = NOW_S * 1000;
    const stop = startOfflinePurge(store, () => clock);
    await store.saveProfiles([ANA], { tutorId: 't', savedAt: NOW_S });
    // Pasan 7 días con la app en segundo plano.
    clock += PROFILES_TTL_SECONDS * 1000;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(await store.profiles()).toEqual([]);
    stop();
    vi.restoreAllMocks();
  });

  it('en segundo plano no purga, y al dejar de escuchar tampoco', async () => {
    const store = new MemoryOfflineStore();
    const purge = vi.spyOn(store, 'purgeExpired');
    const stop = startOfflinePurge(store, () => NOW_S * 1000);
    expect(purge).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(purge).toHaveBeenCalledTimes(1);
    stop();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(purge).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('una copia sin dueño (versión anterior del almacén) también se borra', async () => {
    const store = new MemoryOfflineStore();
    store.cachedProfiles = [ANA];
    startOfflinePurge(store, () => NOW_S * 1000)();
    await settle();
    expect(await store.profiles()).toEqual([]);
  });
});
