import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { ParentalPort, PinError } from '../core/parental/parental.port';

export const PIN_LENGTH = 4;

/**
 * - `enter`: escribir el PIN.  - `create` / `confirm`: crear uno nuevo (o cambiarlo).
 * - `forgot`: escribir la contraseña de la cuenta para poder crear uno nuevo.
 */
export type PinMode = 'loading' | 'enter' | 'create' | 'confirm' | 'forgot';

const MESSAGES: Record<string, string> = {
  not_set: 'Todavía no hay PIN. Crea uno.',
  reauth_required: 'Para crear un PIN nuevo escribe primero el actual o tu contraseña.',
  session: 'Tu sesión no es válida, vuelve a iniciar sesión.',
  network: 'No pude conectar con el servidor.',
  unavailable: 'No pude verificar el PIN. Inténtalo en un momento.',
};

/** PIN del tutor antes de entrar al panel. Reglas: docs/SPEC.md ("PIN del tutor"). */
@Component({
  selector: 'app-pin',
  templateUrl: 'pin.page.html',
  styleUrls: ['pin.page.scss'],
  standalone: false,
})
export class PinPage implements OnInit {
  private readonly parental = inject(ParentalPort);
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  mode: PinMode = 'loading';
  digits = '';
  private first = '';
  /** Cambiar PIN desde el panel (ya desbloqueado). */
  changing = false;
  password = '';
  busy = false;
  error = '';
  protected readonly slots = Array.from({ length: PIN_LENGTH }, (_, i) => i);
  protected readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  get title(): string {
    switch (this.mode) {
      case 'enter':
        return 'Escribe tu PIN';
      case 'create':
        return this.changing ? 'Escribe el PIN nuevo' : 'Crea un PIN de 4 números';
      case 'confirm':
        return 'Repite el PIN';
      case 'forgot':
        return 'Olvidé mi PIN';
      default:
        return '';
    }
  }

  async ngOnInit(): Promise<void> {
    this.changing = this.route.snapshot.queryParamMap.get('cambiar') === '1';
    if (this.changing) {
      this.mode = 'create';
      return;
    }
    try {
      const status = await this.parental.status();
      this.mode = status.hasPin ? 'enter' : 'create';
      if (status.lockedUntil) this.error = lockedMessage(status.lockedUntil);
    } catch (error) {
      this.mode = 'enter';
      this.error = this.message(error);
    } finally {
      this.cdr.markForCheck();
    }
  }

  async press(key: string): Promise<void> {
    if (this.busy || this.mode === 'loading' || this.mode === 'forgot' || !key) return;
    if (key === '⌫') {
      this.digits = this.digits.slice(0, -1);
      return;
    }
    if (this.digits.length >= PIN_LENGTH) return;
    this.digits += key;
    if (this.digits.length === PIN_LENGTH) await this.complete();
  }

  forgot(): void {
    this.mode = 'forgot';
    this.digits = '';
    this.password = '';
    this.error = '';
  }

  async reauth(): Promise<void> {
    const email = this.auth.user()?.email;
    if (!email || !this.password || this.busy) return;
    this.busy = true;
    this.error = '';
    const result = await this.auth.signIn(email, this.password);
    this.password = '';
    this.busy = false;
    if (result.ok) {
      this.changing = true;
      this.mode = 'create';
    } else {
      this.error =
        result.reason === 'invalid_credentials'
          ? 'La contraseña no es correcta.'
          : 'No pude comprobar la contraseña. Inténtalo en un momento.';
    }
    this.cdr.markForCheck();
  }

  cancel(): Promise<boolean> {
    return this.nav.navigateBack('/home');
  }

  private async complete(): Promise<void> {
    const pin = this.digits;
    this.digits = '';
    this.error = '';
    if (this.mode === 'create') {
      this.first = pin;
      this.mode = 'confirm';
      return;
    }
    if (this.mode === 'confirm' && pin !== this.first) {
      this.first = '';
      this.mode = 'create';
      this.error = 'Los PIN no coinciden. Vuelve a crearlo.';
      return;
    }
    this.busy = true;
    try {
      if (this.mode === 'confirm') await this.parental.set(pin);
      else await this.parental.verify(pin);
      await this.nav.navigateRoot('/panel');
    } catch (error) {
      if (error instanceof PinError && (error.code === 'weak' || error.code === 'format')) {
        this.mode = 'create';
      }
      if (error instanceof PinError && error.code === 'not_set') this.mode = 'create';
      this.error = this.message(error);
    } finally {
      this.first = this.mode === 'confirm' ? this.first : '';
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  private message(error: unknown): string {
    if (!(error instanceof PinError)) return MESSAGES['unavailable'];
    if (error.code === 'wrong') {
      const n = error.remaining;
      return n === null
        ? 'PIN incorrecto.'
        : `PIN incorrecto. Te ${n === 1 ? 'queda 1 intento' : `quedan ${n} intentos`}.`;
    }
    if (error.code === 'locked') {
      return 'Demasiados intentos. Espera 15 minutos o usa "Olvidé mi PIN".';
    }
    if ((error.code === 'weak' || error.code === 'format') && error.serverMessage) {
      return error.serverMessage;
    }
    return MESSAGES[error.code] ?? MESSAGES['unavailable'];
  }
}

function lockedMessage(iso: string): string {
  const until = new Date(iso);
  const time = Number.isNaN(until.getTime())
    ? ''
    : ` hasta las ${until.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
  return `El PIN está bloqueado${time} por demasiados intentos. Puedes usar "Olvidé mi PIN".`;
}
