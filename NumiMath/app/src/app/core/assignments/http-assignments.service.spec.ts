import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { localDay } from '../time/local-day';
import { TutorError } from './assignments.port';
import { HttpAssignmentsService } from './http-assignments.service';

const BASE = `${environment.apiUrl}/v1/students/perfil-1/assignments`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(token: string | null = 'jwt-del-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => token } },
    ],
  });
  const session = TestBed.inject(ParentalSession);
  session.start('token-del-pin', 600);
  return {
    service: TestBed.inject(HttpAssignmentsService),
    http: TestBed.inject(HttpTestingController),
    session,
  };
}

describe('HttpAssignmentsService', () => {
  it('la vista del niño no manda el PIN y guarda solo id, texto y estado', async () => {
    const { service, http } = setup();
    const result = service.forKid('perfil-1');
    await tick();
    const req = http.expectOne(BASE);
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-del-tutor');
    expect(req.request.headers.has('X-Parental-Token')).toBe(false);
    req.flush({
      pending: [{ id: 'a', text: '1 + 1 = ?', answer: 2 }],
      done: [{ id: 'b', text: '2 + 2 = ?', status: 'correct', answer: 4 }],
    });
    expect(await result).toEqual({
      pending: [{ id: 'a', text: '1 + 1 = ?' }],
      done: [{ id: 'b', text: '2 + 2 = ?', status: 'correct' }],
    });
  });

  it('la zona del tutor manda el token del PIN', async () => {
    const { service, http } = setup();
    const result = service.all('perfil-1');
    await tick();
    const req = http.expectOne(`${BASE}/all`);
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    req.flush([]);
    await result;
  });

  it('un PIN vencido se traduce a parental_required', async () => {
    const { service, http } = setup();
    const result = service.all('perfil-1').catch((e: TutorError) => e.code);
    await tick();
    http
      .expectOne(`${BASE}/all`)
      .flush({ error: { code: 'parental_required' } }, { status: 401, statusText: 'x' });
    expect(await result).toBe('parental_required');
  });

  it('mapea la lista del tutor', async () => {
    const { service, http } = setup();
    const result = service.all('perfil-1');
    await tick();
    http.expectOne(`${BASE}/all`).flush([
      {
        id: 'a',
        text: '1 + 1 = ?',
        answer: 2,
        status: 'correct',
        created_at: '2026-10-26T10:00:00Z',
        answered_at: '2026-10-26T11:00:00Z',
      },
    ]);
    expect(await result).toEqual([
      {
        id: 'a',
        text: '1 + 1 = ?',
        answer: 2,
        status: 'correct',
        createdAt: '2026-10-26T10:00:00Z',
        answeredAt: '2026-10-26T11:00:00Z',
      },
    ]);
  });

  it('crea, borra y responde con la fecha local', async () => {
    const { service, http } = setup();
    const created = service.create('perfil-1', '2 + 2 = ?', 4);
    await tick();
    const post = http.expectOne(BASE);
    expect(post.request.body).toEqual({ text: '2 + 2 = ?', answer: 4 });
    post.flush({ status: 'ok' });
    await created;

    const removed = service.remove('perfil-1', 'a');
    await tick();
    const del = http.expectOne(`${BASE}/a`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    await removed;

    const answered = service.answer('perfil-1', 'a', 4);
    await tick();
    const ans = http.expectOne(`${BASE}/a/answer`);
    expect(ans.request.body).toEqual({ answer: 4, local_date: localDay() });
    ans.flush({ correct: true, correct_answer: 4 });
    expect(await answered).toEqual({ correct: true, correctAnswer: 4 });
  });

  it('edita con PATCH, el texto y la respuesta, y el token del PIN (T8)', async () => {
    const { service, http } = setup();
    const done = service.update('perfil-1', 'a', '3 + 3 = ?', 6);
    await tick();
    const req = http.expectOne(`${BASE}/a`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ text: '3 + 3 = ?', answer: 6 });
    expect(req.request.headers.has('X-Parental-Token')).toBe(true);
    req.flush(null, { status: 204, statusText: 'No Content' });
    await done;
  });

  it('un rechazo del filtro trae el mensaje para el adulto', async () => {
    const { service, http } = setup();
    const result = service.create('perfil-1', 'x', 1).catch((e: TutorError) => e);
    await tick();
    http.expectOne(BASE).flush(
      { error: { code: 'assignment_rejected', message: 'Quita datos personales.' } },
      { status: 422, statusText: 'Unprocessable' },
    );
    const error = await result;
    expect(error).toBeInstanceOf(TutorError);
    expect((error as TutorError).code).toBe('rejected');
    expect((error as TutorError).serverMessage).toBe('Quita datos personales.');
  });

  it('traduce límite, ya respondida, no encontrada y red', async () => {
    const { service, http } = setup();
    const cases: [number, object | null, string][] = [
      [409, { error: { code: 'assignment_limit', message: 'Máximo 20.' } }, 'limit'],
      [409, { error: { code: 'already_answered' } }, 'already_answered'],
      [404, { error: { code: 'not_found' } }, 'not_found'],
      [503, null, 'unavailable'],
    ];
    for (const [status, body, code] of cases) {
      const result = service.answer('perfil-1', 'a', 1).catch((e: TutorError) => e.code);
      await tick();
      http.expectOne(`${BASE}/a/answer`).flush(body, { status, statusText: 'x' });
      expect(await result).toBe(code);
    }
    const net = service.forKid('perfil-1').catch((e: TutorError) => e.code);
    await tick();
    http.expectOne(BASE).error(new ProgressEvent('error'), { status: 0 });
    expect(await net).toBe('network');
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    await expect(service.forKid('perfil-1')).rejects.toMatchObject({ code: 'session' });
    http.expectNone(BASE);
  });

  it('abrir una tarea pide un ticket y responder lo manda', async () => {
    const { service, http } = setup();
    const started = service.start('perfil-1', 'a');
    await tick();
    const req = http.expectOne(`${BASE}/a/start`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('X-Parental-Token')).toBe(false);
    req.flush({ ticket: 'tk' });
    expect(await started).toBe('tk');

    const answered = service.answer('perfil-1', 'a', 4, 'tk');
    await tick();
    const ans = http.expectOne(`${BASE}/a/answer`);
    expect(ans.request.body).toEqual({ answer: 4, local_date: localDay(), ticket: 'tk' });
    ans.flush({ correct: true, correct_answer: 4 });
    await answered;
  });
});
