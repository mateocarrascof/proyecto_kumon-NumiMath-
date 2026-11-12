import { Injectable, Injector, effect, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';

import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from './parental-session';

/**
 * Zona del tutor: el panel y la pantalla del PIN. `/pin` es parte de la zona porque "Cambiar PIN"
 * va del panel a `/pin?cambiar=1` y el servidor exige el token para cambiarlo.
 */
export function inTutorZone(url: string): boolean {
  return /^\/(panel|pin)(\/|$)/.test(url.split(/[?#]/)[0]);
}

function inPanel(url: string): boolean {
  return /^\/panel(\/|$)/.test(url.split(/[?#]/)[0]);
}

/**
 * Cierra la zona del tutor por CUALQUIER camino (fix: el botón "Inicio" del panel no borraba el
 * token y al volver no se pedía el PIN). En vez de tocar cada botón, se vigila desde un solo lugar:
 * - **Navegación:** al INICIAR una navegación hacia fuera de la zona se borra el token, aunque
 *   después se cancele (en el peor caso se pide el PIN una vez más). Cubre "Inicio", volver (flecha
 *   del navegador o botón atrás de Android), cambiar de perfil, cerrar sesión y cualquier enlace
 *   futuro.
 * - **Sesión:** si se cierra la sesión o cambia el tutor conectado, aunque no haya navegación.
 * - **Segundo plano** (`visibilitychange`, el mismo evento que usan la purga y la sincronización;
 *   sin plugins de Capacitor): al ocultarse la app se borra el token, y al volver, si estaba en el
 *   panel, se lleva a `/pin` para no dejar los datos del niño a la vista sin PIN.
 *
 * Las acciones sensibles (borrar, exportar, revocar, cambiar el PIN) siguen exigiendo el token en
 * el servidor; esto solo decide cuándo la app lo olvida. Reglas: docs/SPEC.md ("PIN del tutor").
 *
 * Devuelve una función para dejar de vigilar (la usan las pruebas).
 */
@Injectable({ providedIn: 'root' })
export class ParentalZoneWatcher {
  private readonly router = inject(Router);
  private readonly session = inject(ParentalSession);
  private readonly auth = inject(AuthPort);
  private readonly injector = inject(Injector);

  start(
    doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
  ): () => void {
    const navigation = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && !inTutorZone(event.url)) this.session.end();
    });

    let lastUser: string | null | undefined;
    const userWatch = effect(
      () => {
        const id = this.auth.user()?.id ?? null;
        if (lastUser !== undefined && id !== lastUser) this.session.end();
        lastUser = id;
      },
      { injector: this.injector },
    );

    const onVisibility = () => {
      if (!doc) return;
      if (doc.visibilityState === 'hidden') {
        this.session.end();
      } else if (doc.visibilityState === 'visible' && inPanel(this.router.url)) {
        // replaceUrl: "volver" desde el PIN no regresa al panel (igual lo pediría el guard).
        void this.router.navigateByUrl('/pin', { replaceUrl: true });
      }
    };
    doc?.addEventListener('visibilitychange', onVisibility);

    return () => {
      navigation.unsubscribe();
      userWatch.destroy();
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }
}
