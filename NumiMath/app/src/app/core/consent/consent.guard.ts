import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ConsentPort } from './consent.port';

/** Rutas que usan datos de niños: sin consentimiento vigente, a /terminos. */
export const consentGuard: CanActivateFn = async () => {
  const consent = inject(ConsentPort);
  const router = inject(Router);
  return (await consent.hasActiveConsent()) ? true : router.createUrlTree(['/terminos']);
};
