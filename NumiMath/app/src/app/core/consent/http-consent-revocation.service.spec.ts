import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { HttpConsentRevocationService } from './http-consent-revocation.service';

const URL = `${environment.apiUrl}/v1/tutor/consent/revoke`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(accessToken: string | null = 'jwt-del-tutor', pin = true) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  if (pin) TestBed.inject(ParentalSession).start('token-del-pin', 600);
  return {
    service: TestBed.inject(HttpConsentRevocationService),
    http: TestBed.inject(HttpTestingController),
  };
}

const BODY = {
  status: 'revoked',
  revoked_at: '2026-11-11T15:30:00+00:00',
  profiles_blocked: 2,
  purge_after_days: 30,
  purge_at: '2026-12-11T15:30:00+00:00',
};

describe('HttpConsentRevocationService', () => {
  it('envía el JWT y el token del PIN, sin cuerpo con datos', async () => {
    const { service, http } = setup();
    const result = service.revoke();
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-del-tutor');
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    expect(req.request.body).toEqual({});
    req.flush(BODY);
    await result;
  });

  it('devuelve la constancia con la fecha y el plazo', async () => {
    const { service, http } = setup();
    const result = service.revoke();
    await tick();
    http.expectOne(URL).flush(BODY);
    expect(await result).toEqual({
      ok: true,
      receipt: {
        revokedAt: '2026-11-11T15:30:00+00:00',
        alreadyRevoked: false,
        profilesBlocked: 2,
        purgeAfterDays: 30,
        purgeAt: '2026-12-11T15:30:00+00:00',
      },
    });
  });

  it('si ya estaba revocado lo marca y conserva la fecha original', async () => {
    const { service, http } = setup();
    const result = service.revoke();
    await tick();
    http.expectOne(URL).flush({ ...BODY, status: 'already_revoked' });
    const out = await result;
    expect(out.ok && out.receipt.alreadyRevoked).toBe(true);
  });

  it.each([
    [401, 'parental_required', 'pin'],
    [409, 'no_consent', 'no_consent'],
    [503, 'service_unavailable', 'error'],
    [500, 'internal_error', 'error'],
  ] as const)('traduce %i %s a "%s"', async (status, code, reason) => {
    const { service, http } = setup();
    const result = service.revoke();
    await tick();
    http.expectOne(URL).flush({ error: { code } }, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it('sin conexión no afirma nada: network', async () => {
    const { service, http } = setup();
    const result = service.revoke();
    await tick();
    http.expectOne(URL).error(new ProgressEvent('error'), { status: 0 });
    expect(await result).toEqual({ ok: false, reason: 'network' });
  });

  it('sin sesión ni siquiera llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.revoke()).toEqual({ ok: false, reason: 'error' });
    http.expectNone(URL);
  });
});
