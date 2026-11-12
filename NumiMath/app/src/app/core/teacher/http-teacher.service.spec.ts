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

  it('lista alumnos, progreso e historial solo con GET y el token del docente', async () => {
    const { service, http } = setup();
    const students = service.listStudents();
    await tick();
    const r1 = http.expectOne(`${environment.apiUrl}/v1/teacher/students`);
    expect(r1.request.method).toBe('GET');
    expect(r1.request.headers.get('Authorization')).toBe('Bearer jwt-docente');
    r1.flush({ students: [{ student_id: 's1', nickname: 'Ana', grade: 2 }] });
    expect(await students).toEqual({ ok: true, students: [{ studentId: 's1', nickname: 'Ana', grade: 2 }] });

    const progress = service.getProgress('s1');
    await tick();
    http.expectOne(`${environment.apiUrl}/v1/teacher/students/s1/progress`).flush({
      nickname: 'Ana',
      grade: 2,
      skills: [{ code: '2-01', label: 'L', module: 'M', level: 2, block_total: 3, block_correct: 2, mastered: false }],
    });
    expect(await progress).toEqual({
      ok: true,
      progress: {
        nickname: 'Ana',
        grade: 2,
        skills: [{ code: '2-01', label: 'L', module: 'M', level: 2, blockTotal: 3, blockCorrect: 2, mastered: false }],
      },
    });

    const history = service.getHistory('s1', 30);
    await tick();
    const r3 = http.expectOne((r) => r.url === `${environment.apiUrl}/v1/teacher/students/s1/history`);
    expect(r3.request.params.get('offset')).toBe('30');
    r3.flush({
      items: [{ label: 'L', tutor_task: true, exercise: null, correct: false, level: 1, day: '2026-11-12' }],
      has_more: false,
      next_offset: null,
    });
    expect(await history).toEqual({
      ok: true,
      page: {
        items: [{ label: 'L', tutorTask: true, exercise: null, correct: false, level: 1, day: '2026-11-12' }],
        hasMore: false,
        nextOffset: null,
      },
    });
  });

  it('lista y abre hojas solo con GET y el token del docente (D8)', async () => {
    const { service, http } = setup();
    const list = service.listSheets('s1', 30);
    await tick();
    const r1 = http.expectOne((r) => r.url === `${environment.apiUrl}/v1/teacher/students/s1/sheets`);
    expect(r1.request.method).toBe('GET');
    expect(r1.request.headers.get('Authorization')).toBe('Bearer jwt-docente');
    expect(r1.request.params.get('offset')).toBe('30');
    r1.flush({
      items: [{ id: 'h1', label: 'L', tutor_task: true, correct: false, day: '2026-11-12' }],
      has_more: false,
      next_offset: null,
    });
    expect(await list).toEqual({
      ok: true,
      page: {
        items: [{ id: 'h1', label: 'L', tutorTask: true, correct: false, day: '2026-11-12' }],
        hasMore: false,
        nextOffset: null,
      },
    });

    const one = service.getSheet('s1', 'h1');
    await tick();
    const stroke = { eraser: false, color: '#2b2d42', width: 4, points: [[1, 2]] };
    http.expectOne(`${environment.apiUrl}/v1/teacher/students/s1/sheets/h1`).flush({
      id: 'h1',
      label: 'L',
      tutor_task: false,
      correct: true,
      day: '2026-11-12',
      statement: '75 - 38',
      child_answer: '37',
      correct_answer: '37',
      strokes: [stroke],
    });
    expect(await one).toEqual({
      ok: true,
      sheet: {
        id: 'h1',
        label: 'L',
        tutorTask: false,
        correct: true,
        day: '2026-11-12',
        statement: '75 - 38',
        childAnswer: '37',
        correctAnswer: '37',
        strokes: [stroke],
      },
    });
  });

  it.each([
    [404, 'not_found'],
    [503, 'error'],
  ])('un %i al abrir una hoja se traduce a %s', async (status, reason) => {
    const { service, http } = setup();
    const result = service.getSheet('s1', 'h1');
    await tick();
    http
      .expectOne(`${environment.apiUrl}/v1/teacher/students/s1/sheets/h1`)
      .flush({}, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it.each([
    [404, 'not_found'],
    [403, 'forbidden'],
    [401, 'forbidden'],
    [503, 'error'],
    [0, 'network'],
  ])('un %i al leer un alumno se traduce a %s', async (status, reason) => {
    const { service, http } = setup();
    const result = service.getProgress('s1');
    await tick();
    const req = http.expectOne(`${environment.apiUrl}/v1/teacher/students/s1/progress`);
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush({}, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.listStudents()).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.getHistory('s1', 0)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.listSheets('s1', 0)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.getSheet('s1', 'h1')).toEqual({ ok: false, reason: 'forbidden' });
    http.expectNone(`${environment.apiUrl}/v1/teacher/students`);
  });
});
