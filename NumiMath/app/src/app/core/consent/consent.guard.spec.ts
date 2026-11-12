import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { ConnectivityService } from '../offline/connectivity.service';
import { MemoryOfflineStore } from '../offline/memory-offline-store';
import { OfflineStore } from '../offline/offline-store.port';
import { consentGuard } from './consent.guard';
import { ConsentPort, ConsentStatus } from './consent.port';

const NOW_S = Math.floor(Date.now() / 1000);
const OWNER = { tutorId: 'tutor-1', savedAt: NOW_S };
const ANA = { id: 'p1', nickname: 'Ana', grade: 2 as const, blocked: false };

async function run(
  status: ConsentStatus,
  opts: {
    browserOnline?: boolean;
    data?: Record<string, unknown>;
    navigated?: boolean;
    /** Una petición anterior ya falló por red (el estado "sin conexión" quedó marcado). */
    failedBefore?: boolean;
  } = {},
) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(opts.browserOnline ?? true);
  const store = new MemoryOfflineStore();
  await store.saveProfiles([ANA], OWNER);
  await store.saveBatch({
    studentId: 'p1', salt: 's', issuedAt: NOW_S, expiresAt: NOW_S + 3600, topics: [], exercises: [],
  });
  const consentStatus = vi.fn(async () => status);
  TestBed.configureTestingModule({
    providers: [
      { provide: ConsentPort, useValue: { consentStatus } },
      {
        provide: Router,
        useValue: {
          navigated: opts.navigated ?? true,
          createUrlTree: (c: string[]) => ({ to: c.join('/') }),
        },
      },
      { provide: OfflineStore, useValue: store },
    ],
  });
  const connectivity = TestBed.inject(ConnectivityService);
  if (opts.failedBefore) connectivity.reportNetworkFailure();
  const result = await TestBed.runInInjectionContext(() =>
    consentGuard({ data: opts.data ?? {}, params: {} } as never, {} as never),
  );
  return { result, store, consentStatus, connectivity };
}

describe('consentGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deja pasar con consentimiento vigente', async () => {
    expect((await run('active')).result).toBe(true);
  });

  it('manda a /terminos sin consentimiento vigente', async () => {
    expect((await run('missing')).result).toEqual({ to: '/terminos' });
  });

  it('sin consentimiento (revocado en otro equipo) borra lo guardado para practicar sin conexión', async () => {
    const { store } = await run('missing');
    expect(await store.profiles()).toEqual([]);
    expect(await store.owner()).toBeNull();
    expect(await store.batch('p1')).toBeNull();
  });

  it('si no se pudo consultar (falla de red) NO borra nada', async () => {
    const { store } = await run('unknown', { data: { offline: true } });
    expect(await store.profiles()).toHaveLength(1);
    expect(await store.batch('p1')).not.toBeNull();
  });
});

describe('consentGuard: el modo sin conexión no se queda pegado (CU-A12)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('tras una falla de red, si el navegador tiene red vuelve a consultar y abre /tareas', async () => {
    const { result, consentStatus, connectivity } = await run('active', { failedBefore: true });
    expect(consentStatus).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(connectivity.online()).toBe(true);
  });

  it('si la consulta falla por red, las rutas de práctica usan la copia local', async () => {
    const { result, connectivity } = await run('unknown', { data: { offline: true } });
    expect(result).toBe(true);
    expect(connectivity.online()).toBe(false);
  });

  it('si la consulta falla por red, las demás rutas no se abren (la pantalla avisa)', async () => {
    expect((await run('unknown')).result).toBe(false);
  });

  it('en la primera carga, si la consulta falla y no hay copia válida, falla cerrado a /terminos', async () => {
    expect((await run('unknown', { navigated: false })).result).toEqual({ to: '/terminos' });
  });
});

describe('consentGuard sin conexión (CU-A12)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deja practicar con el último estado conocido (copia local) sin consultar la red', async () => {
    const { result, consentStatus } = await run('active', {
      browserOnline: false,
      data: { offline: true },
    });
    expect(result).toBe(true);
    expect(consentStatus).not.toHaveBeenCalled();
  });

  it('sin copia local (nadie entró en este equipo o cerró sesión) no deja pasar', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: ConsentPort, useValue: { consentStatus: vi.fn() } },
        { provide: Router, useValue: { navigated: true, createUrlTree: () => null } },
        { provide: OfflineStore, useValue: new MemoryOfflineStore() },
      ],
    });
    const result = await TestBed.runInInjectionContext(() =>
      consentGuard({ data: { offline: true }, params: {} } as never, {} as never),
    );
    expect(result).toBe(false);
  });

  it('las rutas que no son de práctica (panel, términos…) no se abren sin conexión', async () => {
    expect((await run('active', { browserOnline: false })).result).toBe(false);
  });
});
