import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ConnectivityService } from '../offline/connectivity.service';
import { offlineAllowed } from '../offline/offline-access';
import { OfflineStore } from '../offline/offline-store.port';
import { ConsentPort } from './consent.port';

/**
 * Rutas que usan datos de niños: sin consentimiento vigente, a /terminos.
 *
 * CU-A12. Si el navegador cree que hay red, SIEMPRE se intenta en línea (aunque antes haya
 * fallado una petición): así el modo sin conexión no se queda "pegado" cuando la red vuelve.
 * - Vigente: pasa, y se marca que hay conexión.
 * - Sin consentimiento (la base respondió): se borra lo guardado para practicar sin conexión
 *   (revocado desde otro equipo, por ejemplo) y a /terminos.
 * - No se pudo consultar (sin red o la base no respondió): solo las rutas para practicar sin
 *   internet, con el último estado conocido. Las demás no se abren (la pantalla que navegó avisa
 *   "Esto necesita internet"); en la primera carga de la app se va a /terminos, que falla cerrado.
 */
export const consentGuard: CanActivateFn = async (route) => {
  const consent = inject(ConsentPort);
  const router = inject(Router);
  const connectivity = inject(ConnectivityService);
  const store = inject(OfflineStore);
  if (connectivity.browserOnline()) {
    const status = await consent.consentStatus();
    if (status === 'active') {
      connectivity.reportSuccess();
      return true;
    }
    if (status === 'missing') {
      connectivity.reportSuccess();
      await store.clear().catch(() => undefined);
      return router.createUrlTree(['/terminos']);
    }
    connectivity.reportNetworkFailure();
  }
  if (await offlineAllowed(route, store)) return true;
  return router.navigated ? false : router.createUrlTree(['/terminos']);
};
