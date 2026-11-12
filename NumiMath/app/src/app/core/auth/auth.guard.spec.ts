import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';

import { MemoryOfflineStore } from '../offline/memory-offline-store';
import { OfflineStore } from '../offline/offline-store.port';
import { authGuard, guestGuard } from './auth.guard';
import { AuthPort, AuthUser } from './auth.port';

function run(guard: typeof authGuard, user: AuthUser | null) {
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthPort, useValue: { user: signal(user), ready: async () => undefined } },
      { provide: Router, useValue: { createUrlTree: (c: string[]) => ({ to: c.join('/') }) } },
    ],
  });
  return TestBed.runInInjectionContext(() => guard({} as never, {} as never)) as Promise<
    boolean | UrlTree
  >;
}

describe('guards de sesión', () => {
  it('authGuard deja pasar con sesión', async () => {
    expect(await run(authGuard, { id: 'u', email: 'a@b.test' })).toBe(true);
  });

  it('authGuard manda a /login sin sesión', async () => {
    expect(await run(authGuard, null)).toEqual({ to: '/login' });
  });

  it('guestGuard manda a /home si ya hay sesión', async () => {
    expect(await run(guestGuard, { id: 'u', email: 'a@b.test' })).toEqual({ to: '/home' });
  });

  it('guestGuard deja ver /login sin sesión', async () => {
    expect(await run(guestGuard, null)).toBe(true);
  });
});

describe('authGuard sin conexión (CU-A12)', () => {
  afterEach(() => vi.restoreAllMocks());

  async function runOffline(data: Record<string, unknown>, cached: boolean) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const store = new MemoryOfflineStore();
    if (cached) {
      await store.saveProfiles([{ id: 'p1', nickname: 'Ana', grade: 2, blocked: false }], { tutorId: 'tutor-1', savedAt: Math.floor(Date.now() / 1000) });
    }
    TestBed.configureTestingModule({
      providers: [
        // Sin red la sesión puede no renovarse: el usuario queda en null.
        { provide: AuthPort, useValue: { user: signal(null), ready: async () => undefined } },
        { provide: Router, useValue: { createUrlTree: (c: string[]) => ({ to: c.join('/') }) } },
        { provide: OfflineStore, useValue: store },
      ],
    });
    return TestBed.runInInjectionContext(() => authGuard({ data, params: {} } as never, {} as never));
  }

  it('acepta las rutas de práctica si hay copia local de perfiles', async () => {
    expect(await runOffline({ offline: true }, true)).toBe(true);
  });

  it('sin copia local manda a /login', async () => {
    expect(await runOffline({ offline: true }, false)).toEqual({ to: '/login' });
  });

  it('otras rutas siguen exigiendo sesión', async () => {
    expect(await runOffline({}, true)).toEqual({ to: '/login' });
  });
});
