import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import { AdminFailure, AdminPort, AdminTeacher, TeacherChanges } from '../core/admin/admin.port';
import { NAME_MAX } from './admin-teacher-new.page';

const MESSAGES: Record<AdminFailure, string> = {
  email_taken: 'Ese correo ya lo usa otra cuenta. No se cambió nada.',
  invalid: 'Revisa los datos: el servidor no los aceptó.',
  forbidden: 'Tu sesión ya no es válida. Entra de nuevo.',
  not_found: 'Ese docente ya no existe.',
  network: 'No pude conectar con el servidor. Revisa tu conexión.',
  error: 'No pudimos guardar los cambios. Inténtalo de nuevo.',
};

/** Editar cuenta de docente (AD4): nombre y/o correo. El código y los vínculos no cambian. */
@Component({
  selector: 'app-admin-teacher-edit',
  templateUrl: 'admin-teacher-edit.page.html',
  standalone: false,
})
export class AdminTeacherEditPage implements OnInit {
  private readonly admin = inject(AdminPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  loading = true;
  teacher: AdminTeacher | null = null;
  name = '';
  email = '';
  busy = false;
  error = '';
  notice = '';
  protected readonly nameMax = NAME_MAX;

  async ngOnInit(): Promise<void> {
    const id = this.route?.snapshot.paramMap.get('id') ?? '';
    const result = await this.admin.listTeachers();
    this.loading = false;
    if (result.ok) {
      this.teacher = result.teachers.find((t) => t.id === id) ?? null;
      if (this.teacher) {
        this.name = this.teacher.name;
        this.email = this.teacher.email;
      } else {
        this.error = MESSAGES.not_found;
      }
    } else {
      this.error = MESSAGES[result.reason];
    }
    this.cdr.markForCheck();
  }

  private changes(): TeacherChanges {
    const changes: TeacherChanges = {};
    if (!this.teacher) return changes;
    if (this.name.trim() !== this.teacher.name) changes.name = this.name.trim();
    if (this.email.trim().toLowerCase() !== this.teacher.email.toLowerCase()) {
      changes.email = this.email.trim();
    }
    return changes;
  }

  private problem(changes: TeacherChanges): string {
    if (changes.name !== undefined && (changes.name.length < 1 || changes.name.length > NAME_MAX)) {
      return `El nombre debe tener entre 1 y ${NAME_MAX} caracteres.`;
    }
    if (changes.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(changes.email)) {
      return 'Escribe un correo válido.';
    }
    return '';
  }

  async submit(): Promise<void> {
    if (this.busy || !this.teacher) return;
    this.error = '';
    this.notice = '';
    const changes = this.changes();
    if (changes.name === undefined && changes.email === undefined) {
      // Sin cambios: no se hace nada (ni siquiera se llama al servidor).
      this.notice = 'No hay cambios que guardar.';
      return;
    }
    this.error = this.problem(changes);
    if (this.error) return;
    this.busy = true;
    const result = await this.admin.updateTeacher(this.teacher.id, changes);
    this.busy = false;
    if (result.ok) {
      await this.nav.navigateRoot('/admin/docentes');
      return;
    }
    this.error = MESSAGES[result.reason];
    this.cdr.markForCheck();
  }

  async cancel(): Promise<void> {
    await this.nav.navigateRoot('/admin/docentes');
  }
}
