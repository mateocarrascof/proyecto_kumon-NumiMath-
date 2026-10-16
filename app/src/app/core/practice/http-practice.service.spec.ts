import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpPracticeService } from './http-practice.service';
import { PracticeError } from './practice.port';

const BASE = `${environment.apiUrl}/v1/students/perfil-1`;

function setup(token: string | null = 'jwt-del-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => token } },
    ],
  });
  return {
    service: TestBed.inject(HttpPracticeService),
    http: TestBed.inject(HttpTestingController),
  };
}

// Deja que la promesa del token se resuelva antes de inspeccionar la petición.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('HttpPracticeService', () => {
  it('envía el JWT del tutor y mapea el ejercicio', async () => {
    const { service, http } = setup();
    const result = service.newExercise('perfil-1', 'sumas_hasta_20');
    await tick();
    const req = http.expectOne(`${BASE}/exercises`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-del-tutor');
    expect(req.request.body).toEqual({ topic: 'sumas_hasta_20' });
    req.flush({ token: 't', topic: 'sumas_hasta_20', text: '1 + 1 = ?', expires_in: 600 });
    expect(await result).toEqual({
      token: 't',
      topic: 'sumas_hasta_20',
      text: '1 + 1 = ?',
      expiresIn: 600,
    });
  });

  it('envía solo token y número al responder', async () => {
    const { service, http } = setup();
    const result = service.answer('perfil-1', 'tok', 12);
    await tick();
    const req = http.expectOne(`${BASE}/exercises/answer`);
    expect(req.request.body).toEqual({ token: 'tok', answer: 12 });
    req.flush({ correct: true, correct_answer: 12 });
    expect(await result).toEqual({ correct: true, correctAnswer: 12 });
  });

  it('409 = ya respondido y exercise_invalid = vencido', async () => {
    const { service, http } = setup();
    const first = service.answer('perfil-1', 'tok', 1).catch((e: PracticeError) => e.code);
    await tick();
    http
      .expectOne(`${BASE}/exercises/answer`)
      .flush({ error: { code: 'already_answered' } }, { status: 409, statusText: 'Conflict' });
    expect(await first).toBe('already_answered');

    const second = service.answer('perfil-1', 'tok', 1).catch((e: PracticeError) => e.code);
    await tick();
    http
      .expectOne(`${BASE}/exercises/answer`)
      .flush({ error: { code: 'exercise_invalid' } }, { status: 422, statusText: 'Unprocessable' });
    expect(await second).toBe('expired');
  });

  it('401 = sesión no válida y 403 = sin acceso al perfil (mensajes distintos)', async () => {
    const { service, http } = setup();
    const a = service.topics('perfil-1').catch((e: PracticeError) => e.code);
    await tick();
    http.expectOne(`${BASE}/topics`).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await a).toBe('session');
    const b = service.topics('perfil-1').catch((e: PracticeError) => e.code);
    await tick();
    http.expectOne(`${BASE}/topics`).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(await b).toBe('forbidden');
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    await expect(service.topics('perfil-1')).rejects.toBeInstanceOf(PracticeError);
    http.expectNone(`${BASE}/topics`);
  });
});
