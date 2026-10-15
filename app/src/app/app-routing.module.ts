import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';
import { consentGuard } from './core/consent/consent.guard';

const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadChildren: () => import('./login/login.module').then((m) => m.LoginPageModule),
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
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
