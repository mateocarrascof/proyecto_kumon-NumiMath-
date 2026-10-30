import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthPort } from './auth.port';

// Las dependencias se piden ANTES del primer `await`: después ya no hay contexto de inyección.

/** Rutas privadas: sin sesión, a /login. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthPort);
  const router = inject(Router);
  await auth.ready();
  return auth.user() ? true : router.createUrlTree(['/login']);
};

/** /login: si ya hay sesión, a /home. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthPort);
  const router = inject(Router);
  await auth.ready();
  return auth.user() ? router.createUrlTree(['/home']) : true;
};
