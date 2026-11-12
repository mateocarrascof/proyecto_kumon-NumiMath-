import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';
import { consentGuard } from './core/consent/consent.guard';
import { parentalGuard } from './core/parental/parental.guard';

const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadChildren: () => import('./login/login.module').then((m) => m.LoginPageModule),
  },
  {
    path: 'recuperar',
    canActivate: [guestGuard],
    loadChildren: () => import('./recover/recover.module').then((m) => m.RecoverPageModule),
  },
  {
    // Sin guard: el enlace del correo abre esta ruta con los datos de recuperación en la URL.
    path: 'nueva-clave',
    loadChildren: () =>
      import('./new-password/new-password.module').then((m) => m.NewPasswordPageModule),
  },
  {
    path: 'terminos',
    canActivate: [authGuard],
    loadChildren: () => import('./terms/terms.module').then((m) => m.TermsPageModule),
  },
  {
    path: 'home',
    canActivate: [authGuard, consentGuard],
    loadChildren: () => import('./home/home.module').then((m) => m.HomePageModule),
  },
  {
    path: 'perfiles',
    canActivate: [authGuard, consentGuard],
    loadChildren: () => import('./profiles/profiles.module').then((m) => m.ProfilesPageModule),
  },
  {
    path: 'practica/:id',
    canActivate: [authGuard, consentGuard],
    loadChildren: () => import('./practice/practice.module').then((m) => m.PracticePageModule),
  },
  {
    path: 'progreso/:id',
    canActivate: [authGuard, consentGuard],
    loadChildren: () => import('./progress/progress.module').then((m) => m.ProgressPageModule),
  },
  {
    path: 'tareas/:id',
    canActivate: [authGuard, consentGuard],
    loadChildren: () => import('./kid-tasks/kid-tasks.module').then((m) => m.KidTasksPageModule),
  },
  {
    path: 'pin',
    canActivate: [authGuard, consentGuard],
    loadChildren: () => import('./pin/pin.module').then((m) => m.PinPageModule),
  },
  {
    path: 'panel',
    canActivate: [authGuard, consentGuard, parentalGuard],
    loadChildren: () =>
      import('./tutor-panel/tutor-panel.module').then((m) => m.TutorPanelPageModule),
  },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
