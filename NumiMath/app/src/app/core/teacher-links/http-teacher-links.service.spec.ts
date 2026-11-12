import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { HttpTeacherLinksService } from './http-teacher-links.service';

const BASE = `${environment.apiUrl}/v1/students/perfil-1`;
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
  return {
    service: TestBed.inject(HttpTeacherLinksService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpTeacherLinksService', () => {
  it('busca con el JWT, el token del PIN y solo el código', async () => {
    const { service, http } = setup();
    const result = service.lookup('perfil-1', 'XXXX2345');
    await tick();
    const req = http.expectOne(`${BASE}/teacher-links/lookup`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'XXXX2345' });
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-tutor');
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    req.flush({
      teacher_name: 'Docente X',
      confirmation_token: 'tok',
      terms: { id: 'v1', version: 'doc-1', sha256: 'abc' },
    });
    expect(await result).toEqual({
      ok: true,
      teacherName: 'Docente X',
      confirmationToken: 'tok',
      terms: { id: 'v1', version: 'doc-1', sha256: 'abc' },
    });
  });

  it('crea el vínculo enviando el token de confirmación y la aceptación', async () => {
    const { service, http } = setup();
    const result = service.create('perfil-1', 'tok');
    await tick();
    const req = http.expectOne(`${BASE}/teacher-links`);
    expect(req.request.body).toEqual({ confirmation_token: 'tok', accept: true });
    req.flush({ teacher_id: 't1', name: 'Docente X', shown_name: 'Docente X', accepted_at: 'x' });
    expect(await result).toEqual({ ok: true, teacherName: 'Docente X' });
  });

  it('lista y quita', async () => {
    const { service, http } = setup();
    const listed = service.list('perfil-1');
    await tick();
    http.expectOne(`${BASE}/teachers`).flush({
      teachers: [{ teacher_id: 't1', name: 'A', shown_name: 'B', accepted_at: 'x' }],
    });
    expect(await listed).toEqual({
      ok: true,
      teachers: [{ teacherId: 't1', name: 'A', shownName: 'B', acceptedAt: 'x' }],
    });
    const removed = service.remove('perfil-1', 't1');
    await tick();
    const req = http.expectOne(`${BASE}/teachers/t1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await removed).toEqual({ ok: true });
  });

  it.each([
    [404, { error: { code: 'code_not_found' } }, 'not_found'],
    [409, { error: { code: 'already_linked' } }, 'already_linked'],
    [422, { error: { code: 'confirmation_expired' } }, 'expired'],
    [401, { error: { code: 'parental_required' } }, 'pin'],
    [403, { error: { code: 'consent_required' } }, 'consent'],
    [403, { error: { code: 'forbidden' } }, 'forbidden'],
    [503, {}, 'error'],
  ])('un %i (%j) se traduce a %s', async (status, body, reason) => {
    const { service, http } = setup();
    const result = service.lookup('perfil-1', 'XXXX2345');
    await tick();
    http.expectOne(`${BASE}/teacher-links/lookup`).flush(body, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it('un 429 trae los segundos de espera', async () => {
    const { service, http } = setup();
    const result = service.lookup('perfil-1', 'XXXX2345');
    await tick();
    http.expectOne(`${BASE}/teacher-links/lookup`).flush(
      { error: { code: 'rate_limited' } },
      { status: 429, statusText: 'x', headers: new HttpHeaders({ 'Retry-After': '840' }) },
    );
    expect(await result).toEqual({ ok: false, reason: 'locked', retryAfterSeconds: 840 });
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.lookup('perfil-1', 'X')).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.list('perfil-1')).toEqual({ ok: false, reason: 'forbidden' });
    http.expectNone(`${BASE}/teachers`);
  });

  it('verifica el texto de autorización contra su huella', async () => {
    const { service } = setup();
    const bytes = new TextEncoder().encode('texto de prueba');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    vi.stubGlobal('fetch', async () => new Response(bytes, { status: 200 }));
    try {
      expect(await service.loadAuthorizationText(sha)).toEqual({ text: 'texto de prueba', verified: true });
      expect((await service.loadAuthorizationText('0'.repeat(64))).verified).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
