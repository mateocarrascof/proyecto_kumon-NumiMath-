import { OfflineStore } from './offline-store.port';

/**
 * Purga de lo guardado sin conexión (CU-A12): lotes vencidos, intentos cuyo plazo para
 * sincronizar pasó y la copia de perfiles de más de 7 días. NO depende de la red.
 *
 * Se corre al iniciar la app y cada vez que vuelve a primer plano (`visibilitychange`): en un
 * celular o tablet la app casi nunca se cierra del todo, así que solo "al abrir" no bastaría.
 * Con el evento estándar del documento: sin plugins nuevos de Capacitor.
 *
 * Devuelve una función para dejar de escuchar (la usan las pruebas).
 */
export function startOfflinePurge(
  store: OfflineStore,
  now: () => number = () => Date.now(),
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
  // CU-A13: con red, primero se sincroniza la cola y DESPUÉS se purga (así un intento que aún
  // puede enviarse no se pierde por la purga). Sin red, la purga sigue la política igual.
  syncFirst?: () => Promise<unknown>,
  online: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine,
): () => void {
  const purge = () => {
    const before = syncFirst && online() ? syncFirst().catch(() => undefined) : Promise.resolve();
    // Mejor esfuerzo: si el almacén falla ahora, se reintenta la próxima vez.
    void before
      .then(() => store.purgeExpired(Math.floor(now() / 1000)))
      .catch(() => undefined);
  };
  purge();
  if (!doc) return () => undefined;
  const onVisible = () => {
    if (doc.visibilityState === 'visible') purge();
  };
  doc.addEventListener('visibilitychange', onVisible);
  return () => doc.removeEventListener('visibilitychange', onVisible);
}
