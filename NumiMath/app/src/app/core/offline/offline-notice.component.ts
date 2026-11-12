import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Textos del modo sin conexión (CU-A12) para el NIÑO: cortos, amables y sin culpa. Dicen qué
 * puede hacer mientras tanto y, si hace falta internet, que pida ayuda a un adulto.
 */
export const OFFLINE_MESSAGES = {
  banner: 'Estás sin internet. Puedes practicar con los ejercicios guardados.',
  noBatch: 'Para practicar sin internet, primero hay que conectarse una vez. Pide ayuda a un adulto.',
  // Dice qué hacer mientras tanto: elegir otro tema.
  exhausted: 'Ya hiciste todos los ejercicios guardados de este tema. Puedes elegir otro tema.',
  exhaustedTile: 'Sin ejercicios guardados',
  storage: 'No pude guardar tu respuesta. Intenta otra vez.',
  profiles: 'Estás sin internet. Puedes practicar con los ejercicios guardados.',
  // Tareas y "Mi progreso" los calcula el servidor (decisión 4 del ADR 0002).
  needsInternet: 'Esto necesita internet. Cuando vuelva, aquí estará.',
} as const;

/**
 * Aviso del modo sin conexión. Componente aparte para no sumar estilos a la pantalla de práctica
 * (su hoja está al límite del presupuesto). Colores fijos con contraste alto (texto #3d2c00 sobre
 * #fff3cd: más de 12:1) y letra grande para quien está aprendiendo a leer.
 *
 * El propio elemento es la región `role="status"` y está SIEMPRE en la página (aunque vacío): los
 * lectores de pantalla (VoiceOver, TalkBack) solo anuncian cambios dentro de una región que ya
 * existía. Por eso las pantallas lo dejan puesto y cambian solo el texto.
 */
@Component({
  selector: 'app-offline-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite' },
  template: `
    @if (text) {
      <p class="offline-notice" [attr.data-testid]="testId">
        <span class="icon" aria-hidden="true">📴</span>
        <span>{{ text }}</span>
      </p>
    }
  `,
  styles: [
    `
      .offline-notice {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
        margin: 0.5rem auto 1rem;
        max-width: 600px;
        padding: 0.75rem 1rem;
        border-radius: 14px;
        border: 2px solid #e0b400;
        background: #fff3cd;
        color: #3d2c00;
        font-size: 1.15rem;
        line-height: 1.45;
        text-align: left;
      }
      .icon {
        font-size: 1.3rem;
        line-height: 1;
      }
    `,
  ],
})
export class OfflineNoticeComponent {
  @Input({ required: true }) text = '';
  @Input() testId = 'offline-notice';
}
