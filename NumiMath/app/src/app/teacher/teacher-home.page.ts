import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { TeacherPort, TeacherProfile } from '../core/teacher/teacher.port';

/** Lo que vendrá: se muestra desactivado. El docente no ve a ningún niño sin un vínculo activo. */
export const UPCOMING = ['Hojas de cálculo', 'Evolución del progreso'];

/** Inicio del docente: su código de vínculo (D3), el acceso a sus alumnos (D4) y lo que vendrá. */
@Component({
  selector: 'app-teacher-home',
  templateUrl: 'teacher-home.page.html',
  standalone: false,
})
export class TeacherHomePage implements OnInit {
  private readonly teacher = inject(TeacherPort);
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  profile: TeacherProfile | null = null;
  copied = false;
  readonly upcoming = UPCOMING;

  async ngOnInit(): Promise<void> {
    const result = await this.teacher.getProfile();
    this.loading = false;
    if (result.ok) {
      this.profile = result.profile;
    } else if (result.reason === 'forbidden') {
      // La cuenta ya no existe o perdió el rol (por ejemplo, la eliminó el administrador).
      await this.signOut();
      return;
    } else {
      this.error = 'No pude cargar tu código. Revisa tu conexión e inténtalo de nuevo.';
    }
    this.cdr.markForCheck();
  }

  async copy(): Promise<void> {
    if (!this.profile) return;
    try {
      await navigator.clipboard.writeText(this.profile.linkCode);
      this.copied = true;
    } catch {
      this.copied = false;
    }
    this.cdr.markForCheck();
  }

  async openStudents(): Promise<void> {
    await this.nav.navigateForward('/docente/alumnos');
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.nav.navigateRoot('/docente/login');
  }
}
