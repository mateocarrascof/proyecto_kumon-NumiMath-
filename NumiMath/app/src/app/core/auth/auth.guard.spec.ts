import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

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
