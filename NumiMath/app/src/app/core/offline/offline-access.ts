import { ActivatedRouteSnapshot } from '@angular/router';

import { ConnectivityService } from './connectivity.service';
import { PROFILES_TTL_SECONDS } from './offline.model';
import { OfflineStore } from './offline-store.port';

/** ¿Estamos sin conexión? (el navegador lo dice o una petición ya falló por red). */
export function isOffline(connectivity: ConnectivityService): boolean {
  return !(connectivity.online() && connectivity.browserOnline());
}

/**
 * Cuando no se puede consultar en línea, los guards aceptan el último estado conocido SOLO para
 * las rutas marcadas con `data: { offline: true }` (Inicio, "¿Quién practica?" y la práctica).
 * ADR 0002, sección 5. Quien llama decide CUÁNDO usarlo (sin red o si la consulta falló por red).
 *
 * La prueba de "último estado conocido" es la copia local de perfiles con su dueño: solo se guarda
 * tras leer los perfiles con sesión y consentimiento vigentes (la ruta /perfiles los exige), vale
 * 7 días y se borra al cerrar sesión, al revocar el consentimiento, al eliminar la cuenta o si
 * entra otro tutor. En las rutas con `:id` (la práctica), el perfil debe estar en la copia y no
 * estar en pausa: escribir la dirección a mano no salta esa regla.
 */
export async function offlineAllowed(
  route: ActivatedRouteSnapshot | undefined,
  store: OfflineStore,
  nowS = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (route?.data?.['offline'] !== true) return false;
  const [owner, profiles] = await Promise.all([
    store.owner().catch(() => null),
    store.profiles().catch(() => []),
  ]);
  if (!owner || owner.savedAt + PROFILES_TTL_SECONDS <= nowS || !profiles.length) return false;
  const id = route.params?.['id'] as string | undefined;
  if (id === undefined) return true;
  return profiles.some((p) => p.id === id && !p.blocked);
}
