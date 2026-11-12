import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ConnectivityService } from '../offline/connectivity.service';
import { isOffline, offlineAllowed } from '../offline/offline-access';
import { OfflineStore } from '../offline/offline-store.port';
import { ConsentPort } from './consent.port';

/**
 * Rutas que usan datos de niños: sin consentimiento vigente, a /terminos.
 *
 * Sin conexión no se puede consultar el consentimiento. Las rutas para practicar sin internet
 * (CU-A12) se aceptan con el último estado conocido; las demás no se abren (y no se manda al
 * niño a /terminos, que tampoco cargaría sin red).
 */
export const consentGuard: CanActivateFn = async (route) => {
  const consent = inject(ConsentPort);
  const router = inject(Router);
  const connectivity = inject(ConnectivityService);
  const store = inject(OfflineStore);
  if (isOffline(connectivity)) {
    return offlineAllowed(route, connectivity, store);
  }
  return (await consent.hasActiveConsent()) ? true : router.createUrlTree(['/terminos']);
};
