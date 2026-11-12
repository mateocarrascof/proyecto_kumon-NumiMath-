import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { roleGuard, roleGuestGuard } from '../core/auth/auth.guard';
import { TeacherHomePage } from './teacher-home.page';
import { TeacherLoginPage } from './teacher-login.page';

const routes: Routes = [
  { path: 'login', canActivate: [roleGuestGuard('teacher')], component: TeacherLoginPage },
  { path: '', canActivate: [roleGuard('teacher')], component: TeacherHomePage, pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];

/** Zona del docente (`/docente/*`). Sin registro: la cuenta la crea la empresa. */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  declarations: [TeacherLoginPage, TeacherHomePage],
})
export class TeacherModule {}
