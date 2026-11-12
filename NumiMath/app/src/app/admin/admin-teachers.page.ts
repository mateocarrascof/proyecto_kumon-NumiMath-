import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AdminPort, AdminTeacher } from '../core/admin/admin.port';
import { AuthPort } from '../core/auth/auth.port';

/** Lista de docentes (AD3, versión mínima de solo lectura). Editar y eliminar llegan en AD4 y AD5. */
@Component({
  selector: 'app-admin-teachers',
  templateUrl: 'admin-teachers.page.html',
  standalone: false,
})
export class AdminTeachersPage implements OnInit {
  private readonly admin = inject(AdminPort);
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  teachers: AdminTeacher[] = [];

  async ngOnInit(): Promise<void> {
    const result = await this.admin.listTeachers();
    this.loading = false;
    if (result.ok) this.teachers = result.teachers;
    else this.error = 'No pude cargar la lista de docentes. Inténtalo de nuevo.';
    this.cdr.markForCheck();
  }

  async create(): Promise<void> {
    await this.nav.navigateForward('/admin/docentes/nuevo');
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.nav.navigateRoot('/admin/login');
  }
}
