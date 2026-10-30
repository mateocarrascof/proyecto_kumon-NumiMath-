import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ParentalSession } from './parental-session';

/** Zona del tutor: sin PIN verificado (o vencido), a /pin (que vuelve al panel). */
export const parentalGuard: CanActivateFn = () => {
  const session = inject(ParentalSession);
  const router = inject(Router);
  if (session.isUnlocked()) return true;
  return router.createUrlTree(['/pin']);
};
