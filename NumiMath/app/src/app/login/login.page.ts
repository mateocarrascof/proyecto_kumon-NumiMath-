import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import { AuthFailure, AuthPort } from '../core/auth/auth.port';
import { PASSWORD_MIN, passwordProblem } from '../core/auth/password-rules';
import { MascotPort } from '../core/mascot/mascot.port';

const MESSAGES: Record<AuthFailure, string> = {
  invalid_credentials: 'El correo o la contraseña no coinciden.',
  email_taken: 'Ese correo ya tiene una cuenta. Prueba con "Ya tengo cuenta".',
  weak_password: `La contraseña es muy débil. Usa al menos ${PASSWORD_MIN} caracteres.`,
  same_password: 'Elige una contraseña distinta a la anterior.',
  link_expired: 'La sesión venció. Entra de nuevo.',
  network: 'No pude conectar con el servidor. Revisa tu conexión.',
  unknown: 'Algo salió mal. Inténtalo de nuevo.',
};

// Un Map (no un objeto): `?aviso=constructor` no debe devolver nada de Object.prototype.
const NOTICES = new Map<string, string>([
  ['clave-cambiada', 'Listo: cambiaste tu contraseña. Entra con la nueva.'],
  ['cuenta-eliminada', 'Tu cuenta y sus datos se eliminaron. Gracias por usar Matemáticas con Numi.'],
]);

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
  private readonly route = inject(ActivatedRoute, { optional: true });

  mode: LoginMode = 'signin';
  email = '';
  password = '';
  /** Solo al crear cuenta. */
  confirm = '';
  showPassword = false;
  busy = false;
  error = '';
  /** Aviso al volver de otra pantalla (`/login?aviso=…`). Solo valores conocidos: nunca se muestra el parámetro. */
  readonly notice = NOTICES.get(this.route?.snapshot.queryParamMap.get('aviso') ?? '') ?? '';
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
    const problem = passwordProblem(this.password);
    if (problem) {
      this.fail(problem);
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
