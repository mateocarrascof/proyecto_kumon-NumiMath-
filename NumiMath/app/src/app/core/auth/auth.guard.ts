import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ConnectivityService } from '../offline/connectivity.service';
import { isOffline, offlineAllowed } from '../offline/offline-access';
import { OfflineStore } from '../offline/offline-store.port';
import { AuthPort } from './auth.port';

// Las dependencias se piden ANTES del primer `await`: después ya no hay contexto de inyección.

/**
 * Rutas privadas: sin sesión, a /login. Sin conexión, la sesión puede no poder renovarse: las
 * rutas para practicar sin internet (CU-A12) se aceptan con el último estado conocido.
 */
export const authGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthPort);
  const router = inject(Router);
  const connectivity = inject(ConnectivityService);
  const store = inject(OfflineStore);
  await auth.ready();
  if (auth.user()) return true;
  // Sin sesión y sin conexión (la sesión no pudo renovarse): solo las rutas de práctica.
  if (isOffline(connectivity) && (await offlineAllowed(route, store))) return true;
  return router.createUrlTree(['/login']);
};

/** /login: si ya hay sesión, a /home. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthPort);
  const router = inject(Router);
  await auth.ready();
  return auth.user() ? router.createUrlTree(['/home']) : true;
};
