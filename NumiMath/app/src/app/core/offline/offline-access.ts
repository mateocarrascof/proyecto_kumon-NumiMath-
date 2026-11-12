import { ActivatedRouteSnapshot } from '@angular/router';

import { ConnectivityService } from './connectivity.service';
import { OfflineStore } from './offline-store.port';

/** ¿Estamos sin conexión? (el navegador lo dice o una petición ya falló por red). */
export function isOffline(connectivity: ConnectivityService): boolean {
  return !(connectivity.online() && connectivity.browserOnline());
}

/**
 * Sin conexión, los guards aceptan el último estado conocido SOLO para las rutas marcadas con
 * `data: { offline: true }` (Inicio, "¿Quién practica?" y la práctica). ADR 0002, sección 5.
 *
 * La prueba de "último estado conocido" es la copia local de perfiles: solo se guarda tras leer
 * los perfiles con sesión y consentimiento vigentes (la ruta /perfiles los exige), y se borra al
 * cerrar sesión, al revocar el consentimiento o al eliminar la cuenta. No contradice el ADR 0001
 * (sin caché en el servidor): el servidor vuelve a comprobar todo al sincronizar (CU-A13).
 */
export async function offlineAllowed(
  route: ActivatedRouteSnapshot | undefined,
  connectivity: ConnectivityService,
  store: OfflineStore,
): Promise<boolean> {
  if (route?.data?.['offline'] !== true || !isOffline(connectivity)) return false;
  const profiles = await store.profiles().catch(() => []);
  return profiles.length > 0;
}
