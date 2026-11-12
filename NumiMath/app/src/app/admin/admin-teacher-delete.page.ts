import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import { AdminFailure, AdminPort, AdminTeacher } from '../core/admin/admin.port';

const MESSAGES: Record<AdminFailure, string> = {
  email_taken: 'No se pudo eliminar la cuenta.',
  invalid: 'No se pudo eliminar la cuenta.',
  forbidden: 'Tu sesión ya no es válida. Entra de nuevo.',
  not_found: 'Ese docente ya no existe.',
  network: 'No pude conectar con el servidor. Revisa tu conexión.',
  error: 'No pudimos eliminar la cuenta. Revisa la lista y vuelve a intentarlo.',
};

/** Eliminar cuenta de docente (AD5): confirmación que explica qué se borra y qué no. */
@Component({
  selector: 'app-admin-teacher-delete',
  templateUrl: 'admin-teacher-delete.page.html',
  standalone: false,
})
export class AdminTeacherDeletePage implements OnInit {
  private readonly admin = inject(AdminPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  loading = true;
  teacher: AdminTeacher | null = null;
  busy = false;
  error = '';

  async ngOnInit(): Promise<void> {
    const id = this.route?.snapshot.paramMap.get('id') ?? '';
    const result = await this.admin.listTeachers();
    this.loading = false;
    if (result.ok) {
      this.teacher = result.teachers.find((t) => t.id === id) ?? null;
      if (!this.teacher) this.error = MESSAGES.not_found;
    } else {
      this.error = MESSAGES[result.reason];
    }
    this.cdr.markForCheck();
  }

  async confirm(): Promise<void> {
    if (this.busy || !this.teacher) return;
    this.busy = true;
    this.error = '';
    const result = await this.admin.deleteTeacher(this.teacher.id);
    this.busy = false;
    if (result.ok) {
      await this.nav.navigateRoot('/admin/docentes');
      return;
    }
    this.error = MESSAGES[result.reason];
    this.cdr.markForCheck();
  }

  /** Cancelar no cambia nada. */
  async cancel(): Promise<void> {
    await this.nav.navigateRoot('/admin/docentes');
  }
}
