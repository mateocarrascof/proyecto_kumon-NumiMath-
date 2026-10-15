import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';

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
