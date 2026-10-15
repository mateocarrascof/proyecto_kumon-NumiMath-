import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { consentGuard } from './consent.guard';
import { ConsentPort } from './consent.port';

function run(active: boolean) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ConsentPort, useValue: { hasActiveConsent: async () => active } },
      { provide: Router, useValue: { createUrlTree: (c: string[]) => ({ to: c.join('/') }) } },
    ],
  });
  return TestBed.runInInjectionContext(() => consentGuard({} as never, {} as never));
}

describe('consentGuard', () => {
  it('deja pasar con consentimiento vigente', async () => {
    expect(await run(true)).toBe(true);
  });

  it('manda a /terminos sin consentimiento vigente', async () => {
    expect(await run(false)).toEqual({ to: '/terminos' });
  });
});
