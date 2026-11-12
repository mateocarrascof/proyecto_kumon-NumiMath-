import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthPort, UserRole } from './auth.port';

// Las dependencias se piden ANTES del primer `await`: después ya no hay contexto de inyección.

/** Pantalla de entrada de cada rol (sin sesión, o con otro rol, se manda a la suya). */
const LOGIN: Record<UserRole, string> = {
  tutor: '/login',
  teacher: '/docente/login',
  admin: '/admin/login',
};
const HOME: Record<UserRole, string> = {
  tutor: '/home',
  teacher: '/docente',
  admin: '/admin',
};

/** Rutas privadas del tutor: sin sesión (o con sesión de docente/admin), a /login. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthPort);
  const router = inject(Router);
  await auth.ready();
  const user = auth.user();
  return user && (user.role ?? 'tutor') === 'tutor' ? true : router.createUrlTree(['/login']);
};

/** /login: si ya hay sesión de tutor, a /home. Docentes y admins pueden verlo (no es su zona). */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthPort);
  const router = inject(Router);
  await auth.ready();
  const user = auth.user();
  return user && (user.role ?? 'tutor') === 'tutor' ? router.createUrlTree(['/home']) : true;
};

/**
 * Rutas de un rol (`/docente/*`, `/admin/*`). Sin sesión, a la entrada de ese rol; con la sesión
 * de otro rol, a la zona del suyo. El servidor vuelve a comprobar el rol en cada llamada: esto
 * solo ordena la navegación.
 */
export function roleGuard(role: Exclude<UserRole, 'tutor'>): CanActivateFn {
  return async () => {
    const auth = inject(AuthPort);
    const router = inject(Router);
    await auth.ready();
    const user = auth.user();
    if (!user) return router.createUrlTree([LOGIN[role]]);
    const own = user.role ?? 'tutor';
    return own === role ? true : router.createUrlTree([HOME[own]]);
  };
}

/** Entradas `/docente/login` y `/admin/login`: con sesión de ese rol, directo a su zona. */
export function roleGuestGuard(role: Exclude<UserRole, 'tutor'>): CanActivateFn {
  return async () => {
    const auth = inject(AuthPort);
    const router = inject(Router);
    await auth.ready();
    const user = auth.user();
    return user && (user.role ?? 'tutor') === role ? router.createUrlTree([HOME[role]]) : true;
  };
}
