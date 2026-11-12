import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { localDay } from '../time/local-day';
import { HttpPracticeService, keepThousandsTogether } from './http-practice.service';
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
    req.flush({
      token: 't',
      topic: 'sumas_hasta_20',
      text: '1 + 1 = ?',
      level: 2,
      expires_in: 600,
    });
    expect(await result).toEqual({
      token: 't',
      topic: 'sumas_hasta_20',
      text: '1 + 1 = ?',
      level: 2,
      expiresIn: 600,
      answerKind: 'integer',
      blockDone: 0,
      blockSize: 10,
      mastered: false,
    });
  });

  it('mapea el progreso del bloque, el dominio y las fracciones', async () => {
    const { service, http } = setup();
    const result = service.newExercise('perfil-1', '4-10');
    await tick();
    http.expectOne(`${BASE}/exercises`).flush({
      token: 't',
      topic: '4-10',
      text: '2/5 + 1/5 = ?',
      level: 3,
      expires_in: 600,
      answer_kind: 'fraction',
      block_done: 4,
      block_size: 10,
      mastered: true,
    });
    const exercise = await result;
    expect(exercise.answerKind).toBe('fraction');
    expect([exercise.blockDone, exercise.blockSize, exercise.mastered]).toEqual([4, 10, true]);
  });

  it('mapea las habilidades con su eje, nivel y dominio', async () => {
    const { service, http } = setup();
    const result = service.topics('perfil-1');
    await tick();
    http.expectOne(`${BASE}/topics`).flush([
      {
        id: '1-06',
        label: 'Sumas hasta 10',
        module: 'Números y operaciones',
        grade: 1,
        review: false,
        level: 2,
        block_done: 3,
        block_size: 10,
        mastered: false,
      },
    ]);
    expect(await result).toEqual([
      {
        id: '1-06',
        label: 'Sumas hasta 10',
        module: 'Números y operaciones',
        grade: 1,
        review: false,
        level: 2,
        blockDone: 3,
        blockSize: 10,
        mastered: false,
        diagnosticAvailable: false,
      },
    ]);
  });

  it('los miles del nombre no se parten en dos líneas', async () => {
    expect(keepThousandsTogether('Sumas y restas hasta 1 000')).toBe('Sumas y restas hasta 1 000');
    expect(keepThousandsTogether('Valor posicional hasta 10 000')).toBe(
      'Valor posicional hasta 10 000',
    );
    expect(keepThousandsTogether('Contar de 2, 5, 10 y 100')).toBe('Contar de 2, 5, 10 y 100');
    expect(keepThousandsTogether('Tablas del 2 y del 5')).toBe('Tablas del 2 y del 5');

    const { service, http } = setup();
    const result = service.topics('perfil-1');
    await tick();
    http.expectOne(`${BASE}/topics`).flush([{ id: '3-05', label: 'Sumas hasta 1 000' }]);
    expect((await result)[0].label).toBe('Sumas hasta 1 000');
  });

  it('una fracción se envía con su denominador y se lee la forma simple', async () => {
    const { service, http } = setup();
    const result = service.answer('perfil-1', 'tok', 6, 10);
    await tick();
    const req = http.expectOne(`${BASE}/exercises/answer`);
    expect(req.request.body).toEqual({
      token: 'tok',
      answer: 6,
      answer_den: 10,
      local_date: localDay(),
    });
    req.flush({
      correct: true,
      correct_answer: 3,
      correct_answer_den: 5,
      simplified_num: 3,
      simplified_den: 5,
    });
    expect(await result).toEqual({
      correct: true,
      correctAnswer: 3,
      correctAnswerDen: 5,
      simplified: { num: 3, den: 5 },
    });
  });

  it('un nivel ausente o raro se toma como 1', async () => {
    const { service, http } = setup();
    for (const level of [undefined, 0, 7, '3']) {
      const result = service.newExercise('perfil-1', 'sumas_hasta_20');
      await tick();
      http
        .expectOne(`${BASE}/exercises`)
        .flush({ token: 't', topic: 'x', text: '1 + 1 = ?', level, expires_in: 600 });
      expect((await result).level).toBe(1);
    }
  });

  it('envía solo token, número y fecha local al responder', async () => {
    const { service, http } = setup();
    const result = service.answer('perfil-1', 'tok', 12);
    await tick();
    const req = http.expectOne(`${BASE}/exercises/answer`);
    expect(req.request.body).toEqual({ token: 'tok', answer: 12, local_date: localDay() });
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

describe('HttpPracticeService: diagnóstico inicial (CU-A2)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lee si la habilidad ofrece el diagnóstico', async () => {
    const { service, http } = setup();
    const result = service.topics('perfil-1');
    await tick();
    http.expectOne(`${BASE}/topics`).flush([
      { id: '1-06', label: 'Sumas', diagnostic_available: true },
      { id: '1-07', label: 'Restas' },
    ]);
    const [nueva, practicada] = await result;
    expect(nueva.diagnosticAvailable).toBe(true);
    expect(practicada.diagnosticAvailable).toBe(false);
  });

  it('pide el ejercicio de un paso con el JWT del tutor', async () => {
    const { service, http } = setup();
    const result = service.diagnosticExercise('perfil-1', '1-06', 3);
    await tick();
    const req = http.expectOne(`${BASE}/diagnostic/exercises`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-del-tutor');
    expect(req.request.body).toEqual({ topic: '1-06', step: 3 });
    req.flush({
      token: 't',
      topic: '1-06',
      text: '4 + 5 = ?',
      level: 2,
      step: 3,
      steps: 6,
      expires_in: 600,
    });
    expect(await result).toEqual({
      token: 't',
      topic: '1-06',
      text: '4 + 5 = ?',
      level: 2,
      expiresIn: 600,
      answerKind: 'integer',
    });
  });

  it('envía las 6 respuestas juntas, sin fecha local (no suma a la racha)', async () => {
    const { service, http } = setup();
    const answers = [
      { token: 'a', answer: 3 },
      { token: 'b', answer: 3, answerDen: 5 },
    ];
    const result = service.submitDiagnostic('perfil-1', '1-06', answers);
    await tick();
    const req = http.expectOne(`${BASE}/diagnostic`);
    expect(req.request.body).toEqual({
      topic: '1-06',
      answers: [
        { token: 'a', answer: 3 },
        { token: 'b', answer: 3, answer_den: 5 },
      ],
    });
    expect('local_date' in req.request.body).toBe(false);
    req.flush({ level: 2 });
    expect(await result).toBe(2);
  });

  it('un 409 (ya no disponible) se traduce como ya respondido', async () => {
    const { service, http } = setup();
    const result = service.submitDiagnostic('perfil-1', '1-06', []);
    await tick();
    http
      .expectOne(`${BASE}/diagnostic`)
      .flush({ error: { code: 'diagnostic_not_available' } }, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toEqual(new PracticeError('already_answered'));
  });

  it('una prueba vencida se traduce como vencida', async () => {
    const { service, http } = setup();
    const result = service.submitDiagnostic('perfil-1', '1-06', []);
    await tick();
    http
      .expectOne(`${BASE}/diagnostic`)
      .flush({ error: { code: 'exercise_invalid' } }, { status: 422, statusText: 'Unprocessable' });
    await expect(result).rejects.toEqual(new PracticeError('expired'));
  });
});
