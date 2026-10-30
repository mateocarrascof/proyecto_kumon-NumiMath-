import { Injectable, signal } from '@angular/core';

/**
 * Token parental (PIN verificado) de la zona del tutor.
 *
 * Solo en memoria: no se guarda en localStorage ni en ningún lado; al recargar la app se pide el
 * PIN otra vez. El servidor lo valida en cada llamada del panel; aquí solo se decide si mostrar
 * la pantalla del PIN. Reglas: docs/SPEC.md ("PIN del tutor").
 */
@Injectable({ providedIn: 'root' })
export class ParentalSession {
  private readonly state = signal<{ token: string; until: number } | null>(null);

  /** Para pruebas. */
  now: () => number = () => Date.now();

  start(token: string, expiresInSeconds: number): void {
    // Un margen de 15 s evita usar un token a punto de vencer.
    this.state.set({ token, until: this.now() + Math.max(0, expiresInSeconds - 15) * 1000 });
  }

  token(): string | null {
    const s = this.state();
    return s && this.now() < s.until ? s.token : null;
  }

  isUnlocked(): boolean {
    return this.token() !== null;
  }

  /** Cabecera para las llamadas del panel (vacía si no hay token vigente). */
  header(): Record<string, string> {
    const token = this.token();
    return token ? { 'X-Parental-Token': token } : {};
  }

  end(): void {
    this.state.set(null);
  }
}
