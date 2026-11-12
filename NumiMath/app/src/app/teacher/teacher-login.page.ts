import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';

/** Mismo mensaje para clave incorrecta y para una cuenta que no es de docente. */
const BAD_CREDENTIALS = 'El correo o la contraseña no coinciden.';

/** Entrada del docente (D2). Sin registro desde la app: la empresa entrega correo y contraseña. */
@Component({
  selector: 'app-teacher-login',
  templateUrl: 'teacher-login.page.html',
  standalone: false,
})
export class TeacherLoginPage {
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  email = '';
  password = '';
  showPassword = false;
  busy = false;
  error = '';

  async submit(): Promise<void> {
    if (this.busy) return;
    const email = this.email.trim();
    if (!email.includes('@') || !this.password) {
      this.error = 'Escribe tu correo y tu contraseña.';
      return;
    }
    this.busy = true;
    this.error = '';
    const result = await this.auth.signIn(email, this.password);
    this.password = '';
    if (result.ok && this.auth.user()?.role !== 'teacher') {
      // Una cuenta válida que no es de docente no entra por aquí ni se entera de por qué.
      await this.auth.signOut();
      this.error = BAD_CREDENTIALS;
    } else if (!result.ok) {
      this.error =
        result.reason === 'network'
          ? 'No pude conectar con el servidor. Revisa tu conexión.'
          : result.reason === 'invalid_credentials'
            ? BAD_CREDENTIALS
            : 'Algo salió mal. Inténtalo de nuevo.';
    }
    this.busy = false;
    this.cdr.markForCheck();
    if (!this.error) await this.nav.navigateRoot('/docente');
  }
}
