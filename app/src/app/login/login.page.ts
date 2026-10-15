import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthFailure, AuthPort } from '../core/auth/auth.port';
import { MascotPort } from '../core/mascot/mascot.port';

const MESSAGES: Record<AuthFailure, string> = {
  invalid_credentials: 'El correo o la contraseña no coinciden.',
  email_taken: 'Ese correo ya tiene una cuenta. Prueba con "Iniciar sesión".',
  weak_password: 'La contraseña es muy débil. Usa al menos 8 caracteres.',
  network: 'No pude conectar con el servidor. Revisa tu conexión.',
  unknown: 'Algo salió mal. Inténtalo de nuevo.',
};

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

  mode: 'signin' | 'signup' = 'signin';
  email = '';
  password = '';
  busy = false;
  error = '';

  get title(): string {
    return this.mode === 'signin' ? 'Iniciar sesión' : 'Crear cuenta';
  }

  toggleMode(): void {
    this.mode = this.mode === 'signin' ? 'signup' : 'signin';
    this.error = '';
  }

  async submit(): Promise<void> {
    if (this.busy) return;
    const email = this.email.trim();
    if (!email.includes('@')) {
      this.fail('Escribe un correo válido.');
      return;
    }
    if (this.password.length < 8) {
      this.fail('La contraseña debe tener al menos 8 caracteres.');
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
