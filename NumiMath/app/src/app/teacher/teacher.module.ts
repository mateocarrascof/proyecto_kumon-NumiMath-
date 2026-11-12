import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { roleGuard, roleGuestGuard } from '../core/auth/auth.guard';
import { CoreModule } from '../core/core.module';
import { TeacherHistoryPage } from './teacher-history.page';
import { TeacherHomePage } from './teacher-home.page';
import { TeacherLoginPage } from './teacher-login.page';
import { TeacherSheetsPage } from './teacher-sheets.page';
import { TeacherStudentPage } from './teacher-student.page';
import { TeacherStudentsPage } from './teacher-students.page';

const routes: Routes = [
  { path: 'login', canActivate: [roleGuestGuard('teacher')], component: TeacherLoginPage },
  { path: '', canActivate: [roleGuard('teacher')], component: TeacherHomePage, pathMatch: 'full' },
  { path: 'alumnos', canActivate: [roleGuard('teacher')], component: TeacherStudentsPage },
  { path: 'alumnos/:id', canActivate: [roleGuard('teacher')], component: TeacherStudentPage },
  {
    path: 'alumnos/:id/historial',
    canActivate: [roleGuard('teacher')],
    component: TeacherHistoryPage,
  },
  {
    path: 'alumnos/:id/hojas',
    canActivate: [roleGuard('teacher')],
    component: TeacherSheetsPage,
  },
  { path: '**', redirectTo: '' },
];

/** Zona del docente (`/docente/*`). Sin registro: la cuenta la crea la empresa. */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, CoreModule, RouterModule.forChild(routes)],
  declarations: [
    TeacherLoginPage,
    TeacherHomePage,
    TeacherStudentsPage,
    TeacherStudentPage,
    TeacherHistoryPage,
    TeacherSheetsPage,
  ],
})
export class TeacherModule {}
