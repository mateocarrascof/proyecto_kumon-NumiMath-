import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { roleGuard, roleGuestGuard } from '../core/auth/auth.guard';
import { AdminLoginPage } from './admin-login.page';
import { AdminTeacherDeletePage } from './admin-teacher-delete.page';
import { AdminTeacherEditPage } from './admin-teacher-edit.page';
import { AdminTeacherNewPage } from './admin-teacher-new.page';
import { AdminTeachersPage } from './admin-teachers.page';

const routes: Routes = [
  { path: 'login', canActivate: [roleGuestGuard('admin')], component: AdminLoginPage },
  { path: 'docentes', canActivate: [roleGuard('admin')], component: AdminTeachersPage },
  { path: 'docentes/nuevo', canActivate: [roleGuard('admin')], component: AdminTeacherNewPage },
  { path: 'docentes/:id/editar', canActivate: [roleGuard('admin')], component: AdminTeacherEditPage },
  {
    path: 'docentes/:id/eliminar',
    canActivate: [roleGuard('admin')],
    component: AdminTeacherDeletePage,
  },
  { path: '', redirectTo: 'docentes', pathMatch: 'full' },
  { path: '**', redirectTo: 'docentes' },
];

/** Zona del administrador (`/admin/*`): solo gestiona cuentas de docentes, nunca datos de niños. */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  declarations: [
    AdminLoginPage,
    AdminTeachersPage,
    AdminTeacherNewPage,
    AdminTeacherEditPage,
    AdminTeacherDeletePage,
  ],
})
export class AdminModule {}
