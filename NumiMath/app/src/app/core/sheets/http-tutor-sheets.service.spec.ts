import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { HttpTutorSheetsService } from './http-tutor-sheets.service';

const BASE = `${environment.apiUrl}/v1/students/perfil-1/sheets`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const STROKE = { eraser: false, color: '#2b2d42', width: 4, points: [[1, 2]] };

function setup(accessToken: string | null = 'sesion-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  TestBed.inject(ParentalSession).start('token-del-pin', 600);
  return {
    service: TestBed.inject(HttpTutorSheetsService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpTutorSheetsService (T27)', () => {
  it('lista con la sesión, el token del PIN y el desplazamiento', async () => {
    const { service, http } = setup();
    const result = service.list('perfil-1', 30);
    await tick();
    const req = http.expectOne((r) => r.url === BASE);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer sesion-tutor');
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    expect(req.request.params.get('offset')).toBe('30');
    req.flush({
      items: [
        {
          id: 'h1',
          label: 'Restas',
          tutor_task: false,
          correct: true,
          statement: '75 - 38',
          saved_at: '2026-11-12T15:30:00Z',
        },
      ],
      has_more: false,
      next_offset: null,
      total: 1,
    });
    expect(await result).toEqual({
      ok: true,
      page: {
        items: [
          {
            id: 'h1',
            label: 'Restas',
            tutorTask: false,
            correct: true,
            statement: '75 - 38',
            savedAt: '2026-11-12T15:30:00Z',
          },
        ],
        hasMore: false,
        nextOffset: null,
        total: 1,
      },
    });
  });

  it('abre una hoja con trazos y respuestas', async () => {
    const { service, http } = setup();
    const result = service.get('perfil-1', 'h1');
    await tick();
    http.expectOne(`${BASE}/h1`).flush({
      id: 'h1',
      label: 'Restas',
      tutor_task: false,
      correct: false,
      statement: '75 - 38',
      saved_at: '2026-11-12T15:30:00Z',
      child_answer: '47',
      correct_answer: '37',
      strokes: [STROKE],
    });
    const out = await result;
    expect(out.ok && out.sheet.childAnswer).toBe('47');
    expect(out.ok && out.sheet.strokes).toEqual([STROKE]);
  });

  it('borra una hoja con DELETE y el token del PIN', async () => {
    const { service, http } = setup();
    const result = service.remove('perfil-1', 'h1');
    await tick();
    const req = http.expectOne(`${BASE}/h1`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toEqual({ ok: true, deleted: 1 });
  });

  it('borra todas y dice cuántas fueron', async () => {
    const { service, http } = setup();
    const result = service.removeAll('perfil-1');
    await tick();
    const req = http.expectOne(BASE);
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: 4 });
    expect(await result).toEqual({ ok: true, deleted: 4 });
  });

  it.each([
    [404, undefined, 'not_found'],
    [401, 'parental_required', 'pin'],
    [403, undefined, 'forbidden'],
    [503, undefined, 'error'],
    [0, undefined, 'network'],
  ])('un %i (%s) se traduce a %s', async (status, code, reason) => {
    const { service, http } = setup();
    const result = service.remove('perfil-1', 'h1');
    await tick();
    const req = http.expectOne(`${BASE}/h1`);
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush({ error: { code } }, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.list('perfil-1', 0)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.removeAll('perfil-1')).toEqual({ ok: false, reason: 'forbidden' });
    http.expectNone(BASE);
  });
});
