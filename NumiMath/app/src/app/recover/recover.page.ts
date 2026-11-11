import { ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';

import { AuthPort } from '../core/auth/auth.port';
import { pickPhrase } from '../core/mascot/mascot-phrases';
import { MascotPort } from '../core/mascot/mascot.port';

/** Mismo texto siempre: no revela si el correo tiene cuenta. */
export const RECOVER_NEUTRAL_MESSAGE =
  'Si ese correo tiene una cuenta, te enviamos un enlace para crear una contraseña nueva. ' +
  'Revisa tu bandeja de entrada (y la carpeta de spam). El enlace dura 30 minutos y sirve una sola vez.';

/** Pausa entre pedidos desde esta pantalla (el servidor también limita por correo y en total). */
export const RECOVER_COOLDOWN_SECONDS = 60;

@Component({
  selector: 'app-recover',
  templateUrl: 'recover.page.html',
  styleUrls: ['../login/login.page.scss'],
  standalone: false,
})
export class RecoverPage implements OnDestroy {
  private readonly auth = inject(AuthPort);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly mascot = inject(MascotPort);

  email = '';
  sent = false;
  busy = false;
  error = '';
  cooldown = 0;
  protected readonly message = RECOVER_NEUTRAL_MESSAGE;
  protected readonly greeting = pickPhrase('recover');
  private timer: ReturnType<typeof setInterval> | undefined;

  async submit(): Promise<void> {
    if (this.busy || this.cooldown > 0) return;
    const email = this.email.trim();
    if (!email.includes('@')) {
      this.error = 'Escribe un correo válido.';
      this.mascot.set('sad');
      this.cdr.markForCheck();
      return;
    }
    this.busy = true;
    this.error = '';
    this.mascot.set('thinking');
    await this.auth.requestPasswordReset(email);
    this.busy = false;
    this.sent = true;
    this.mascot.set('happy');
    this.startCooldown();
    this.cdr.markForCheck();
  }

  private startCooldown(): void {
    this.cooldown = RECOVER_COOLDOWN_SECONDS;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.cooldown -= 1;
      if (this.cooldown <= 0) clearInterval(this.timer);
      this.cdr.markForCheck();
    }, 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
