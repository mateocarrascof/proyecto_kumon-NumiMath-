import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { MemoryOfflineStore } from '../offline/memory-offline-store';
import { OfflineStore } from '../offline/offline-store.port';
import { consentGuard } from './consent.guard';
import { ConsentPort } from './consent.port';

function run(active: boolean) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ConsentPort, useValue: { hasActiveConsent: async () => active } },
      { provide: Router, useValue: { createUrlTree: (c: string[]) => ({ to: c.join('/') }) } },
    ],
  });
  return TestBed.runInInjectionContext(() => consentGuard({} as never, {} as never));
}

describe('consentGuard', () => {
  it('deja pasar con consentimiento vigente', async () => {
    expect(await run(true)).toBe(true);
  });

  it('manda a /terminos sin consentimiento vigente', async () => {
    expect(await run(false)).toEqual({ to: '/terminos' });
  });
});

describe('consentGuard sin conexión (CU-A12)', () => {
  afterEach(() => vi.restoreAllMocks());

  async function runOffline(data: Record<string, unknown>, cached: boolean) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const store = new MemoryOfflineStore();
    if (cached) await store.saveProfiles([{ id: 'p1', nickname: 'Ana', grade: 2, blocked: false }]);
    const hasActiveConsent = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        { provide: ConsentPort, useValue: { hasActiveConsent } },
        { provide: Router, useValue: { createUrlTree: (c: string[]) => ({ to: c.join('/') }) } },
        { provide: OfflineStore, useValue: store },
      ],
    });
    const result = await TestBed.runInInjectionContext(() =>
      consentGuard({ data } as never, {} as never),
    );
    return { result, hasActiveConsent };
  }

  it('deja practicar con el último estado conocido (copia local) sin consultar la red', async () => {
    const { result, hasActiveConsent } = await runOffline({ offline: true }, true);
    expect(result).toBe(true);
    expect(hasActiveConsent).not.toHaveBeenCalled();
  });

  it('sin copia local (nadie entró en este equipo o cerró sesión) no deja pasar', async () => {
    expect((await runOffline({ offline: true }, false)).result).toBe(false);
  });

  it('las rutas que no son de práctica (panel, términos…) no se abren sin conexión', async () => {
    expect((await runOffline({}, true)).result).toBe(false);
  });
});
