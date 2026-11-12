import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { ConsentRevocationPort } from '../core/consent/consent-revocation.port';
import { ParentalSession } from '../core/parental/parental-session';

/**
 * "Revocar mi consentimiento" (zona del tutor, con el PIN). Antes de confirmar explica qué pasa con
 * los datos; al confirmar, la API revoca, comprueba que ningún perfil queda activo y devuelve la
 * constancia con fecha, que se muestra en la pantalla siguiente (/terminos).
 */
@Component({
  selector: 'app-revoke-consent',
  standalone: false,
  styles: [
    `
      .card { background: var(--kid-card-bg); border: 1px solid var(--kid-border); border-radius: var(--kid-radius-sm); box-shadow: var(--kid-shadow); padding: 12px 14px; margin-top: 16px; }
      .hint { color: var(--ion-color-medium-shade, #555); font-size: 0.95rem; }
      .error { color: var(--ion-color-danger); font-weight: 700; }
      .confirm { margin-top: 10px; padding: 12px; border-radius: var(--kid-radius-sm); background: var(--kid-coral-soft); }
      .confirm p { margin: 0 0 8px; }
      .confirm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    `,
  ],
  template: `
    <section class="card" aria-label="Revocar mi consentimiento">
      <h2>Revocar mi consentimiento</h2>
      @if (!open) {
        <p class="hint">
          Retira el consentimiento que diste para tratar los datos de tus niños. Puedes hacerlo
          cuando quieras.
        </p>
        <ion-button fill="outline" (click)="toggle()" data-testid="open-revoke-consent">
          Revocar consentimiento…
        </ion-button>
      } @else {
        <div class="confirm" data-testid="revoke-consent-form">
          <p><strong>Desde ese momento</strong> no se usa la información de tus niños: sus
            perfiles quedan bloqueados, sin práctica, tareas, informes ni IA.</p>
          <p><strong>Sus datos no se borran al instante:</strong> quedan guardados y bloqueados,
            sin acceso, durante un plazo limitado (te diremos la fecha al confirmar). Pasado ese
            plazo se borran para siempre, con su progreso. Puedes borrarlos antes eliminando tu
            cuenta.</p>
          <p data-testid="revoke-offline-note"><strong>En un equipo sin internet,</strong> el borrado
            de lo guardado para practicar sin conexión ocurre al conectarse (esos datos dejan de
            usarse a los 7 días).</p>
          <p><strong>Tu cuenta sigue activa</strong> hasta que la elimines. Dejamos constancia de tu
            revocación con su fecha y hora, y ese registro se conserva mientras exista tu cuenta.</p>
          <p><strong>Aceptar los términos otra vez no reactiva</strong> los perfiles que ya quedaron
            bloqueados.</p>
          @if (error) {
            <p class="error" role="alert" data-testid="revoke-consent-error">{{ error }}</p>
          }
          <div class="confirm-actions">
            <ion-button
              color="danger"
              [disabled]="busy"
              (click)="confirm()"
              data-testid="confirm-revoke-consent"
            >{{ busy ? 'Revocando…' : 'Sí, revocar el consentimiento' }}</ion-button>
            <ion-button fill="outline" (click)="toggle()">Cancelar</ion-button>
          </div>
        </div>
      }
    </section>
  `,
})
export class RevokeConsentComponent {
  private readonly revocation = inject(ConsentRevocationPort);
  private readonly session = inject(ParentalSession);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  open = false;
  busy = false;
  error = '';

  toggle(): void {
    this.open = !this.open;
    this.error = '';
    this.cdr.markForCheck();
  }

  async confirm(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.cdr.markForCheck();

    const result = await this.revocation.revoke();
    if (result.ok) {
      // Ya no hay consentimiento: la zona del tutor deja de estar disponible. La constancia
      // (fecha, perfiles y plazo) se muestra en /terminos.
      this.session.end();
      const { revokedAt, purgeAt, purgeAfterDays } = result.receipt;
      await this.nav.navigateRoot('/terminos', {
        queryParams: {
          revocado: revokedAt,
          ...(purgeAt ? { borrado: purgeAt } : {}),
          ...(purgeAfterDays ? { dias: purgeAfterDays } : {}),
        },
      });
      return;
    }
    const messages = {
      pin: 'Tu sesión del panel venció. Vuelve a escribir tu PIN.',
      no_consent: 'Todavía no habías aceptado los términos: no hay nada que revocar.',
      network: 'No pude confirmar si se revocó. Revisa tu conexión y vuelve a intentarlo.',
      error: 'No pudimos confirmar la revocación. Puede que ya esté hecha: vuelve a entrar para comprobarlo.',
    } as const;
    this.error = messages[result.reason];
    this.busy = false;
    this.cdr.markForCheck();
  }
}
