import { TestBed } from '@angular/core/testing';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import {
  ConsentRevocationPort,
  RevokeConsentResult,
} from '../core/consent/consent-revocation.port';
import { ParentalSession } from '../core/parental/parental-session';
import { RevokeConsentComponent } from './revoke-consent.component';

const OK: RevokeConsentResult = {
  ok: true,
  receipt: {
    revokedAt: '2026-11-11T15:30:00+00:00',
    alreadyRevoked: false,
    profilesBlocked: 2,
    purgeAfterDays: 30,
    purgeAt: '2026-12-11T15:30:00+00:00',
  },
};

function setup(result: RevokeConsentResult = OK) {
  const revoke = vi.fn(async () => result);
  const navigateRoot = vi.fn(async () => true);
  TestBed.configureTestingModule({
    declarations: [RevokeConsentComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: ConsentRevocationPort, useValue: { revoke } },
      { provide: NavController, useValue: { navigateRoot } },
    ],
  });
  const fixture = TestBed.createComponent(RevokeConsentComponent);
  return { fixture, c: fixture.componentInstance, revoke, navigateRoot };
}

describe('RevokeConsentComponent', () => {
  it('empieza cerrado y NO revoca hasta que se confirme', () => {
    const { fixture, revoke } = setup();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="revoke-consent-form"]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('antes de confirmar explica qué pasa con los datos, el plazo y la constancia', () => {
    const { fixture, c } = setup();
    c.toggle();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Desde ese momento');
    expect(text).toContain('no se usa la información de tus niños');
    expect(text).toContain('no se borran al instante');
    expect(text).toContain('sin acceso');
    expect(text).toContain('eliminando tu cuenta');
    expect(text).toContain('Tu cuenta sigue activa');
    expect(text).toContain('plazo');
    expect(text).toContain('constancia');
    expect(text).toContain('no reactiva');
  });

  it('cancelar cierra sin llamar a la API', () => {
    const { c, revoke } = setup();
    c.toggle();
    c.toggle();
    expect(c.open).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('al confirmar revoca, termina la sesión del PIN y lleva a /terminos con la constancia', async () => {
    const { c, revoke, navigateRoot } = setup();
    const session = TestBed.inject(ParentalSession);
    session.start('token', 600);
    await c.confirm();
    expect(revoke).toHaveBeenCalledOnce();
    expect(session.isUnlocked()).toBe(false);
    expect(navigateRoot).toHaveBeenCalledWith('/terminos', {
      queryParams: {
        revocado: '2026-11-11T15:30:00+00:00',
        borrado: '2026-12-11T15:30:00+00:00',
        dias: 30,
      },
    });
  });

  it('sin perfiles no inventa un plazo de borrado', async () => {
    const { c, navigateRoot } = setup({
      ok: true,
      receipt: {
        revokedAt: '2026-11-11T15:30:00+00:00',
        alreadyRevoked: false,
        profilesBlocked: 0,
        purgeAfterDays: null,
        purgeAt: null,
      },
    });
    await c.confirm();
    expect(navigateRoot).toHaveBeenCalledWith('/terminos', {
      queryParams: { revocado: '2026-11-11T15:30:00+00:00' },
    });
  });

  it.each([
    ['pin', 'Vuelve a escribir tu PIN'],
    ['no_consent', 'no hay nada que revocar'],
    ['network', 'No pude confirmar si se revocó'],
    ['error', 'Puede que ya esté hecha'],
  ] as const)('si falla (%s) avisa, no navega y no afirma que se revocó', async (reason, text) => {
    const { c, navigateRoot } = setup({ ok: false, reason });
    const session = TestBed.inject(ParentalSession);
    session.start('token', 600);
    await c.confirm();
    expect(c.error).toContain(text);
    expect(c.busy).toBe(false);
    expect(navigateRoot).not.toHaveBeenCalled();
    expect(session.isUnlocked()).toBe(true); // sin confirmación no se cierra nada
  });

  it('no manda dos solicitudes si se pulsa dos veces', async () => {
    const { c, revoke } = setup();
    const first = c.confirm();
    await c.confirm();
    await first;
    expect(revoke).toHaveBeenCalledOnce();
  });
});
