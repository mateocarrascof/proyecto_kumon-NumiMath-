import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { MemoryOfflineStore } from '../offline/memory-offline-store';
import { OfflineStore } from '../offline/offline-store.port';
import { authGuard, guestGuard, roleGuard, roleGuestGuard } from './auth.guard';
import { AuthPort, AuthUser } from './auth.port';

function run(guard: CanActivateFn, user: AuthUser | null) {
  TestBed.resetTestingModule();
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

  it('authGuard no deja pasar a docente ni a admin a las rutas del tutor', async () => {
    expect(await run(authGuard, { id: 'u', email: 'a@b.test', role: 'teacher' })).toEqual({
      to: '/login',
    });
    expect(await run(authGuard, { id: 'u', email: 'a@b.test', role: 'admin' })).toEqual({
      to: '/login',
    });
  });

  it('guestGuard deja ver /login a docente y admin (sin bucle hacia /home)', async () => {
    expect(await run(guestGuard, { id: 'u', email: 'a@b.test', role: 'teacher' })).toBe(true);
    expect(await run(guestGuard, { id: 'u', email: 'a@b.test', role: 'admin' })).toBe(true);
  });
});

describe('roleGuard', () => {
  const teacher: AuthUser = { id: 'u', email: 'a@b.test', role: 'teacher' };
  const admin: AuthUser = { id: 'u', email: 'a@b.test', role: 'admin' };

  it('deja pasar al rol correcto', async () => {
    expect(await run(roleGuard('teacher'), teacher)).toBe(true);
    expect(await run(roleGuard('admin'), admin)).toBe(true);
  });

  it('sin sesión va a la entrada de ese rol', async () => {
    expect(await run(roleGuard('teacher'), null)).toEqual({ to: '/docente/login' });
    expect(await run(roleGuard('admin'), null)).toEqual({ to: '/admin/login' });
  });

  it('con otro rol va a la zona del suyo', async () => {
    expect(await run(roleGuard('admin'), teacher)).toEqual({ to: '/docente' });
    expect(await run(roleGuard('teacher'), admin)).toEqual({ to: '/admin' });
    expect(await run(roleGuard('admin'), { id: 'u', email: 'a@b.test' })).toEqual({
      to: '/home',
    });
  });

  it('roleGuestGuard manda a su zona a quien ya tiene sesión de ese rol', async () => {
    expect(await run(roleGuestGuard('admin'), admin)).toEqual({ to: '/admin' });
    expect(await run(roleGuestGuard('admin'), teacher)).toBe(true);
    expect(await run(roleGuestGuard('admin'), null)).toBe(true);
  });
});

describe('guards sin conexión (CU-A12)', () => {
  afterEach(() => vi.restoreAllMocks());

  async function runOffline(
    data: Record<string, unknown>,
    cached: boolean,
    guard: CanActivateFn = authGuard,
    user: AuthUser | null = null,
  ) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const store = new MemoryOfflineStore();
    if (cached) {
      await store.saveProfiles([{ id: 'p1', nickname: 'Ana', grade: 2, blocked: false }], { tutorId: 'tutor-1', savedAt: Math.floor(Date.now() / 1000) });
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        // Sin red la sesión puede no renovarse: el usuario queda en null.
        { provide: AuthPort, useValue: { user: signal(user), ready: async () => undefined } },
        { provide: Router, useValue: { createUrlTree: (c: string[]) => ({ to: c.join('/') }) } },
        { provide: OfflineStore, useValue: store },
      ],
    });
    return TestBed.runInInjectionContext(() => guard({ data, params: {} } as never, {} as never));
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

  it('sin conexión y sin sesión no se entra a /admin ni a /docente, ni con copia local', async () => {
    expect(await runOffline({ offline: true }, true, roleGuard('admin'))).toEqual({
      to: '/admin/login',
    });
    expect(await runOffline({ offline: true }, true, roleGuard('teacher'))).toEqual({
      to: '/docente/login',
    });
  });

  it('un docente o un admin con sesión no entra a la práctica del tutor, ni sin conexión', async () => {
    const teacher: AuthUser = { id: 'u', email: 'a@b.test', role: 'teacher' };
    const admin: AuthUser = { id: 'u', email: 'a@b.test', role: 'admin' };
    expect(await runOffline({ offline: true }, true, authGuard, teacher)).toEqual({ to: '/login' });
    expect(await runOffline({ offline: true }, true, authGuard, admin)).toEqual({ to: '/login' });
  });

  it('un docente no entra al panel del tutor: va a su zona', async () => {
    const teacher: AuthUser = { id: 'u', email: 'a@b.test', role: 'teacher' };
    expect(await runOffline({}, false, roleGuard('admin'), teacher)).toEqual({ to: '/docente' });
    expect(await run(authGuard, teacher)).toEqual({ to: '/login' });
  });
});
