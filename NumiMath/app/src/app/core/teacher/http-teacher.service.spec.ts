import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpTeacherService } from './http-teacher.service';

const URL = `${environment.apiUrl}/v1/teacher/me`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(accessToken: string | null = 'jwt-docente') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  return { service: TestBed.inject(HttpTeacherService), http: TestBed.inject(HttpTestingController) };
}

describe('HttpTeacherService', () => {
  it('pide el perfil con el token del docente', async () => {
    const { service, http } = setup();
    const result = service.getProfile();
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-docente');
    req.flush({ name: 'Ana', link_code: 'AAAA2345' });
    expect(await result).toEqual({ ok: true, profile: { name: 'Ana', linkCode: 'AAAA2345' } });
  });

  it.each([
    [403, 'forbidden'],
    [401, 'forbidden'],
    [503, 'error'],
    [0, 'network'],
  ])('un %i se traduce a %s', async (status, reason) => {
    const { service, http } = setup();
    const result = service.getProfile();
    await tick();
    const req = http.expectOne(URL);
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush({}, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.getProfile()).toEqual({ ok: false, reason: 'forbidden' });
    http.expectNone(URL);
  });
});
