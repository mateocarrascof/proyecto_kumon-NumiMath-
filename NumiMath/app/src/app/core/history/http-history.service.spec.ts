import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { HttpHistoryService } from './http-history.service';

const URL = `${environment.apiUrl}/v1/students/perfil-1/history`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(accessToken: string | null = 'jwt-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  TestBed.inject(ParentalSession).start('token-del-pin', 600);
  return { service: TestBed.inject(HttpHistoryService), http: TestBed.inject(HttpTestingController) };
}

describe('HttpHistoryService', () => {
  it('pide la página con el JWT, el token del PIN y el desplazamiento', async () => {
    const { service, http } = setup();
    const result = service.page('perfil-1', 30);
    await tick();
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('offset')).toBe('30');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-tutor');
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    req.flush({
      items: [{ label: 'L', tutor_task: true, correct: false, level: 1, answered_at: '2026-11-12T15:30:00Z' }],
      has_more: true,
      next_offset: 31,
    });
    expect(await result).toEqual({
      ok: true,
      page: {
        items: [{ label: 'L', tutorTask: true, correct: false, level: 1, answeredAt: '2026-11-12T15:30:00Z' }],
        hasMore: true,
        nextOffset: 31,
      },
    });
  });

  it.each([
    [401, { error: { code: 'parental_required' } }, 'pin'],
    [403, { error: { code: 'forbidden' } }, 'forbidden'],
    [503, {}, 'error'],
  ])('un %i (%j) se traduce a %s', async (status, body, reason) => {
    const { service, http } = setup();
    const result = service.page('perfil-1', 0);
    await tick();
    http.expectOne((r) => r.url === URL).flush(body, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.page('perfil-1', 0)).toEqual({ ok: false, reason: 'forbidden' });
    http.expectNone(URL);
  });
});
