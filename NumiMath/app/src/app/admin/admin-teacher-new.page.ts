import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AdminFailure, AdminPort, CreatedTeacher } from '../core/admin/admin.port';

export const NAME_MAX = 60;
export const INITIAL_PASSWORD_MIN = 8;
export const INITIAL_PASSWORD_MAX = 72;

const MESSAGES: Record<AdminFailure, string> = {
  email_taken: 'Ese correo ya tiene una cuenta. Usa otro correo; no se creó nada.',
  invalid: 'Algún dato no está bien escrito. Revísalos e inténtalo de nuevo.',
  forbidden: 'Tu sesión se cerró. Vuelve a entrar para seguir.',
  not_found: 'Algo falló y no se creó la cuenta. Inténtalo de nuevo en un momento.',
  network: 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
  error: 'Algo falló y no se creó la cuenta. Inténtalo de nuevo en un momento.',
};

/** Crear cuenta de docente (AD2). La contraseña inicial la escribe el administrador. */
@Component({
  selector: 'app-admin-teacher-new',
  templateUrl: 'admin-teacher-new.page.html',
  styleUrls: ['admin-teacher-new.page.scss'],
  standalone: false,
})
export class AdminTeacherNewPage {
  private readonly admin = inject(AdminPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  name = '';
  email = '';
  password = '';
  showPassword = false;
  busy = false;
  error = '';
  /** Se muestra una sola vez; al salir de la pantalla no se conserva en ninguna parte. */
  created: CreatedTeacher | null = null;
  copied = '';
  protected readonly nameMax = NAME_MAX;
  protected readonly passwordMin = INITIAL_PASSWORD_MIN;

  private problem(): string {
    const name = this.name.trim();
    if (name.length < 1 || name.length > NAME_MAX) {
      return `Escribe el nombre del docente (máximo ${NAME_MAX} caracteres).`;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email.trim())) return 'Revisa el correo: debe ser como nombre@colegio.cl.';
    if (
      this.password.length < INITIAL_PASSWORD_MIN ||
      this.password.length > INITIAL_PASSWORD_MAX
    ) {
      return `La contraseña debe tener entre ${INITIAL_PASSWORD_MIN} y ${INITIAL_PASSWORD_MAX} caracteres.`;
    }
    return '';
  }

  async submit(): Promise<void> {
    if (this.busy) return;
    this.error = this.problem();
    if (this.error) return;
    this.busy = true;
    const result = await this.admin.createTeacher({
      name: this.name.trim(),
      email: this.email.trim(),
      password: this.password,
    });
    this.busy = false;
    if (result.ok) {
      this.created = result.teacher;
      this.password = '';
    } else {
      this.error = MESSAGES[result.reason];
    }
    this.cdr.markForCheck();
  }

  async copy(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied = label;
    } catch {
      this.copied = '';
    }
    this.cdr.markForCheck();
  }

  async done(): Promise<void> {
    this.created = null;
    await this.nav.navigateRoot('/admin/docentes');
  }
}
