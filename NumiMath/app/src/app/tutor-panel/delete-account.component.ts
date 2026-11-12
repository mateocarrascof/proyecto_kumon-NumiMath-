import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AccountPort, DELETE_ACCOUNT_WORD } from '../core/account/account.port';
import { AuthPort } from '../core/auth/auth.port';
import { ParentalSession } from '../core/parental/parental-session';

/**
 * "Eliminar mi cuenta" (zona del tutor, ya protegida con PIN). Confirmación fuerte: se pide la
 * CONTRASEÑA de la cuenta (el PIN lo puede conocer un niño; la contraseña no) y hay que escribir la
 * palabra ELIMINAR. Explica qué se borra y qué se conserva.
 */
@Component({
  selector: 'app-delete-account',
  standalone: false,
  styles: [
    `
      .card { background: var(--kid-card-bg); border: 1px solid var(--kid-border); border-radius: var(--kid-radius-sm); box-shadow: var(--kid-shadow); padding: 12px 14px; margin-top: 16px; }
      .danger-zone { border-color: var(--ion-color-danger); }
      .hint { color: var(--ion-color-medium-shade, #555); font-size: 0.95rem; }
      .error { color: var(--ion-color-danger); font-weight: 700; }
      .confirm { margin-top: 10px; padding: 12px; border-radius: var(--kid-radius-sm); background: var(--kid-coral-soft); }
      .confirm p { margin: 0 0 8px; }
      .confirm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    `,
  ],
  template: `
    <section class="card danger-zone" aria-label="Eliminar mi cuenta">
      <h2>Eliminar mi cuenta</h2>
      @if (!open) {
        <p class="hint">Borra tu cuenta y todos los datos de tus niños. No se puede deshacer.</p>
        <ion-button color="danger" fill="outline" (click)="toggle()" data-testid="open-delete-account">
          Eliminar mi cuenta…
        </ion-button>
      } @else {
        <div class="confirm" data-testid="delete-account-form">
          <p><strong>Se borra para siempre:</strong> tu cuenta y tu correo, los perfiles de tus niños
            (apodo y curso), su progreso, rachas y tareas, tu PIN y tus consentimientos.</p>
          <p><strong>Se conserva</strong> solo un registro mínimo para poder probar que aceptaste
            los términos: la fecha, la versión del texto, el canal y un código irreversible (no
            muestra tu correo ni tu nombre), más la declaración del adulto sin apodo ni curso. Se
            borra solo a los 5 años (plazo provisional, sujeto a validación legal).</p>
          <p><strong>Fuera de nuestro control:</strong> copias de seguridad, registros técnicos de la
            plataforma y los correos que ya te enviamos pueden conservarse un tiempo limitado.
            Esto no se puede deshacer.</p>
          <ion-input
            label="Escribe ELIMINAR para confirmar"
            labelPlacement="stacked"
            autocomplete="off"
            autocapitalize="characters"
            [value]="word"
            (ionInput)="onWord($any($event.target).value)"
            data-testid="delete-account-word"
          ></ion-input>
          <ion-input
            type="password"
            label="Tu contraseña de la cuenta"
            labelPlacement="stacked"
            autocomplete="current-password"
            [value]="password"
            (ionInput)="onPassword($any($event.target).value)"
            data-testid="delete-account-password"
          ></ion-input>
          @if (error) {
            <p class="error" role="alert" data-testid="delete-account-error">{{ error }}</p>
          }
          <div class="confirm-actions">
            <ion-button
              color="danger"
              [disabled]="!ready"
              (click)="confirm()"
              data-testid="confirm-delete-account"
            >{{ busy ? 'Eliminando…' : 'Eliminar para siempre' }}</ion-button>
            <ion-button fill="outline" (click)="toggle()">Cancelar</ion-button>
          </div>
        </div>
      }
    </section>
  `,
})
export class DeleteAccountComponent {
  private readonly account = inject(AccountPort);
  private readonly session = inject(ParentalSession);
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  open = false;
  word = '';
  password = '';
  busy = false;
  error = '';

  get ready(): boolean {
    // Se acepta en minúsculas (los teléfonos capitalizan solo la primera letra); al servidor siempre
    // se le envía la palabra exacta.
    return this.word.trim().toUpperCase() === DELETE_ACCOUNT_WORD && this.password.length > 0 && !this.busy;
  }

  toggle(): void {
    this.open = !this.open;
    this.word = '';
    this.password = '';
    this.error = '';
    this.cdr.markForCheck();
  }

  onWord(value: string | null | undefined): void {
    this.word = (value ?? '').slice(0, 20);
  }

  onPassword(value: string | null | undefined): void {
    this.password = (value ?? '').slice(0, 200);
  }

  async confirm(): Promise<void> {
    if (!this.ready) return;
    this.busy = true;
    this.error = '';
    this.cdr.markForCheck();

    // Confirmación fuerte: volver a entrar con la contraseña. Da una sesión "recién iniciada con
    // contraseña", que es lo que el servidor acepta para esta acción.
    const email = this.auth.user()?.email ?? '';
    const login = await this.auth.signIn(email, this.password);
    this.password = '';
    if (!login.ok) {
      this.fail(
        login.reason === 'invalid_credentials'
          ? 'La contraseña no coincide.'
          : 'No pude verificar tu contraseña. Inténtalo en un momento.',
      );
      return;
    }

    const result = await this.account.delete(DELETE_ACCOUNT_WORD);
    if (result === 'ok') {
      // La cuenta ya no existe: se cierra la sesión local (puede fallar si Auth ya no la conoce).
      await this.auth.signOut().catch(() => undefined);
      this.session.end();
      await this.nav.navigateRoot('/login', { queryParams: { aviso: 'cuenta-eliminada' } });
      return;
    }
    const messages: Record<string, string> = {
      pin: 'Tu sesión venció. Vuelve a escribir tu contraseña.',
      confirm: `Escribe ${DELETE_ACCOUNT_WORD} para confirmar.`,
      network: 'No pude confirmar si la cuenta se eliminó. Vuelve a entrar para comprobarlo.',
      error: 'No pudimos confirmar que la cuenta se eliminó. Vuelve a entrar para comprobarlo o inténtalo de nuevo.',
    };
    this.fail(messages[result]);
  }

  private fail(message: string): void {
    this.error = message;
    this.busy = false;
    this.cdr.markForCheck();
  }
}
