import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthFailure, AuthPort } from '../core/auth/auth.port';
import { MascotPort } from '../core/mascot/mascot.port';

export const PASSWORD_MIN = 8;

const MESSAGES: Record<AuthFailure, string> = {
  invalid_credentials: 'El correo o la contraseña no coinciden.',
  email_taken: 'Ese correo ya tiene una cuenta. Prueba con "Ya tengo cuenta".',
  weak_password: `La contraseña es muy débil. Usa al menos ${PASSWORD_MIN} caracteres.`,
  network: 'No pude conectar con el servidor. Revisa tu conexión.',
  unknown: 'Algo salió mal. Inténtalo de nuevo.',
};

export type LoginMode = 'signin' | 'signup';

/**
 * Inicio de sesión y creación de cuenta del ADULTO. Son dos vistas bien distintas (color, textos,
 * Numi y campos) para que no se confundan; se cambia con las pestañas de arriba.
 */
@Component({
  selector: 'app-login',
  templateUrl: 'login.page.html',
  styleUrls: ['login.page.scss'],
  standalone: false,
})
export class LoginPage {
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  protected readonly mascot = inject(MascotPort);
  private readonly cdr = inject(ChangeDetectorRef);

  mode: LoginMode = 'signin';
  email = '';
  password = '';
  /** Solo al crear cuenta. */
  confirm = '';
  showPassword = false;
  busy = false;
  error = '';
  protected readonly passwordMin = PASSWORD_MIN;

  get title(): string {
    return this.mode === 'signin' ? '¡Hola de nuevo!' : 'Crea tu cuenta de adulto';
  }

  get action(): string {
    return this.mode === 'signin' ? 'Entrar' : 'Crear mi cuenta';
  }

  get greeting(): string {
    return this.mode === 'signin' ? '¡Qué bueno verte!' : '¡Bienvenido! Vamos paso a paso.';
  }

  get longEnough(): boolean {
    return this.password.length >= PASSWORD_MIN;
  }

  get matches(): boolean {
    return this.confirm.length > 0 && this.confirm === this.password;
  }

  setMode(mode: LoginMode | string | null | undefined): void {
    if ((mode !== 'signin' && mode !== 'signup') || mode === this.mode) return;
    this.mode = mode;
    this.error = '';
    this.password = '';
    this.confirm = '';
    this.showPassword = false;
    this.mascot.set(mode === 'signup' ? 'happy' : 'idle');
  }

  toggleMode(): void {
    this.setMode(this.mode === 'signin' ? 'signup' : 'signin');
  }

  async submit(): Promise<void> {
    if (this.busy) return;
    const email = this.email.trim();
    if (!email.includes('@')) {
      this.fail('Escribe un correo válido.');
      return;
    }
    if (this.password.length < PASSWORD_MIN) {
      this.fail(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
      return;
    }
    if (this.mode === 'signup' && this.confirm !== this.password) {
      this.fail('Las dos contraseñas no coinciden.');
      return;
    }
    this.busy = true;
    this.error = '';
    this.mascot.set('thinking');
    const result =
      this.mode === 'signin'
        ? await this.auth.signIn(email, this.password)
        : await this.auth.signUp(email, this.password);
    this.busy = false;
    this.password = '';
    this.confirm = '';
    this.cdr.markForCheck();
    if (result.ok) {
      this.mascot.set('happy');
      await this.nav.navigateRoot('/home');
    } else {
      this.fail(MESSAGES[result.reason]);
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.mascot.set('sad');
    this.cdr.markForCheck();
  }
}
