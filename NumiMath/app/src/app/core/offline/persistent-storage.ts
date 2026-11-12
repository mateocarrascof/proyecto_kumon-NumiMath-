import { Capacitor } from '@capacitor/core';

/**
 * Pide al navegador que no borre lo guardado para practicar sin conexión (ADR 0002, riesgos).
 *
 * - Solo en la web: en la app nativa (Capacitor) el sistema no purga así los datos de la app.
 * - Solo desde la zona del tutor: en algunos navegadores (Firefox) aparece un diálogo de permiso,
 *   y ese diálogo no debe verlo un niño.
 * - Si ya está concedido, no se vuelve a pedir. Mejor esfuerzo: el navegador puede decir que no.
 */
export async function requestPersistentStorage(): Promise<void> {
  if (Capacitor.isNativePlatform()) return;
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist || !storage.persisted) return;
    if (await storage.persisted()) return;
    await storage.persist();
  } catch {
    // Sin permiso o sin soporte: la práctica sin conexión funciona igual.
  }
}
