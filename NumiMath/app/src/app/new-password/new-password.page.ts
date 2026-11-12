import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthFailure, AuthPort, RecoveryLink } from '../core/auth/auth.port';
import { PASSWORD_MIN, passwordProblem } from '../core/auth/password-rules';
import { MascotPort } from '../core/mascot/mascot.port';

const MESSAGES: Record<AuthFailure, string> = {
  invalid_credentials: 'El enlace ya no sirve. Pide uno nuevo.',
  email_taken: 'El enlace ya no sirve. Pide uno nuevo.',
  weak_password: `La contraseña es muy débil. Usa al menos ${PASSWORD_MIN} caracteres.`,
  same_password: 'Elige una contraseña distinta a la anterior.',
  link_expired: 'El enlace ya no sirve o venció. Pide uno nuevo.',
  network: 'No pude conectar con el servidor. Revisa tu conexión.',
  unknown: 'No pude guardar la contraseña. Inténtalo de nuevo.',
};

/** `confirm`: el enlace trae un código; falta que la persona pulse el botón para canjearlo. */
export type NewPasswordState = 'checking' | 'confirm' | 'ready' | 'invalid';

/**
 * Destino del enlace del correo: `/nueva-clave?token_hash=…&type=recovery`. El código se lee y se
 * borra de la barra de direcciones enseguida, pero NO se canjea al abrir la página: solo cuando la
 * persona pulsa el botón. Así un escáner de correo (o un previsualizador de chat) que abra el
 * enlace no lo gasta ni obtiene una sesión.
 */
@Component({
  selector: 'app-new-password',
  templateUrl: 'new-password.page.html',
  styleUrls: ['../login/login.page.scss'],
  standalone: false,
})
export class NewPasswordPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly mascot = inject(MascotPort);

  state: NewPasswordState = 'checking';
  private link: RecoveryLink | null = null;
  password = '';
  confirm = '';
  showPassword = false;
  busy = false;
  error = '';
  protected readonly passwordMin = PASSWORD_MIN;

  get longEnough(): boolean {
    return this.password.length >= PASSWORD_MIN;
  }

  get matches(): boolean {
    return this.confirm.length > 0 && this.confirm === this.password;
  }

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = params.get('type');
    // El código no debe quedarse en la URL (historial, capturas, "compartir pantalla").
    window.history.replaceState(null, '', window.location.pathname);
    this.link = tokenHash && type ? { tokenHash, type } : null;
    this.state = this.link ? 'confirm' : 'invalid';
    this.mascot.set(this.link ? 'idle' : 'sad');
    this.cdr.markForCheck();
  }

  /** Canjea el código del enlace (una sola vez) y abre el formulario. */
  async confirmLink(): Promise<void> {
    if (this.busy || this.state !== 'confirm' || !this.link) return;
    this.busy = true;
    this.cdr.markForCheck();
    const link = this.link;
    this.link = null; // el código sirve una sola vez: no se reintenta con el mismo
    this.state = (await this.auth.beginRecovery(link)) === 'ready' ? 'ready' : 'invalid';
    this.busy = false;
    this.mascot.set(this.state === 'ready' ? 'idle' : 'sad');
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    // Si se sale sin cambiar la contraseña, la sesión de recuperación se cierra (no hace nada si ya
    // se completó).
    void this.auth.cancelRecovery();
  }

  async submit(): Promise<void> {
    if (this.busy || this.state !== 'ready') return;
    const problem = passwordProblem(this.password);
    if (problem) return this.fail(problem);
    if (this.confirm !== this.password) return this.fail('Las dos contraseñas no coinciden.');
    this.busy = true;
    this.error = '';
    this.mascot.set('thinking');
    const result = await this.auth.completePasswordReset(this.password);
    this.busy = false;
    this.password = '';
    this.confirm = '';
    if (result.ok) {
      this.mascot.set('happy');
      await this.nav.navigateRoot('/login', { queryParams: { aviso: 'clave-cambiada' } });
      return;
    }
    if (result.reason === 'link_expired' || result.reason === 'invalid_credentials') {
      this.state = 'invalid';
    }
    this.fail(MESSAGES[result.reason]);
  }

  private fail(message: string): void {
    this.error = message;
    this.mascot.set('sad');
    this.cdr.markForCheck();
  }
}
