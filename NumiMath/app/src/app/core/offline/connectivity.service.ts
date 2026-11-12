import { Injectable, signal } from '@angular/core';

/**
 * ¿Hay conexión? (CU-A12, paso 1 de la ficha). `navigator.onLine` solo no basta: puede decir
 * "conectado" con una red sin internet. Por eso además se marca sin conexión cuando una petición
 * falla por red, y se vuelve a "conectado" cuando una petición responde o el navegador avisa
 * que volvió la red.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly state = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online = this.state.asReadonly();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.state.set(true));
    window.addEventListener('offline', () => this.state.set(false));
  }

  /** Una petición falló por red (sin respuesta del servidor). */
  reportNetworkFailure(): void {
    this.state.set(false);
  }

  /** Una petición respondió: hay conexión. */
  reportSuccess(): void {
    this.state.set(true);
  }

  /** ¿Vale la pena intentar en línea? (el navegador cree que hay red). */
  browserOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }
}
