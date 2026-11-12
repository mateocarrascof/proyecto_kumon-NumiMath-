import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpAccountService } from './http-account.service';

const URL = `${environment.apiUrl}/v1/tutor/account/delete`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(accessToken: string | null = 'jwt-del-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  return {
    service: TestBed.inject(HttpAccountService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpAccountService', () => {
  it('envía el JWT y la palabra de confirmación, y nunca el token del PIN', async () => {
    const { service, http } = setup();
    const result = service.delete('ELIMINAR');
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-del-tutor');
    expect(req.request.headers.has('X-Parental-Token')).toBe(false);
    expect(req.request.body).toEqual({ confirm: 'ELIMINAR' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBe('ok');
  });

  it('no manda nada del niño ni identificadores del tutor en el cuerpo', async () => {
    const { service, http } = setup();
    const result = service.delete('ELIMINAR');
    await tick();
    const req = http.expectOne(URL);
    expect(Object.keys(req.request.body as object)).toEqual(['confirm']);
    expect(req.request.urlWithParams).toBe(URL);
    req.flush(null, { status: 204, statusText: 'No Content' });
    await result;
  });

  it('traduce los errores del servidor a motivos cerrados', async () => {
    for (const [status, code, expected] of [
      [401, 'parental_required', 'pin'],
      [422, 'confirmation_required', 'confirm'],
      [503, 'service_unavailable', 'error'],
      [500, 'internal_error', 'error'],
    ] as const) {
      TestBed.resetTestingModule();
      const { service, http } = setup();
      const result = service.delete('ELIMINAR');
      await tick();
      http.expectOne(URL).flush({ error: { code } }, { status, statusText: 'x' });
      expect(await result).toBe(expected);
    }
  });

  it('sin conexión devuelve network', async () => {
    const { service, http } = setup();
    const result = service.delete('ELIMINAR');
    await tick();
    http.expectOne(URL).error(new ProgressEvent('error'));
    expect(await result).toBe('network');
  });

  it('sin sesión ni siquiera llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.delete('ELIMINAR')).toBe('error');
    http.expectNone(URL);
  });
});
