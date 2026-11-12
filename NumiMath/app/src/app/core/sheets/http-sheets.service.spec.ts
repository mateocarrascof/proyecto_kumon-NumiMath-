import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpSheetsService } from './http-sheets.service';
import { SheetStroke } from './sheets.port';

const STROKES: SheetStroke[] = [{ eraser: false, color: '#2b2d42', width: 4, points: [[1, 2]] }];
const BASE = `${environment.apiUrl}/v1/students/perfil-1`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(accessToken: string | null = 'sesion-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  return { service: TestBed.inject(HttpSheetsService), http: TestBed.inject(HttpTestingController) };
}

describe('HttpSheetsService', () => {
  it('guarda la hoja de un ejercicio con la sesión, la respuesta y solo los trazos', async () => {
    const { service, http } = setup();
    const result = service.savePractice('perfil-1', 'ticket-ejercicio', 12, null, STROKES);
    await tick();
    const req = http.expectOne(`${BASE}/exercises/sheet`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer sesion-tutor');
    expect(req.request.body).toEqual({ token: 'ticket-ejercicio', answer: 12, strokes: STROKES });
    req.flush({ saved: true });
    expect(await result).toBe(true);
  });

  it('en fracciones manda también el denominador', async () => {
    const { service, http } = setup();
    const result = service.savePractice('perfil-1', 't', 3, 5, STROKES);
    await tick();
    const req = http.expectOne(`${BASE}/exercises/sheet`);
    expect(req.request.body.answer_den).toBe(5);
    req.flush({ saved: false });
    expect(await result).toBe(false);
  });

  it('guarda la hoja de una tarea del tutor por el id de la tarea', async () => {
    const { service, http } = setup();
    const result = service.saveTask('perfil-1', 'tarea-9', 10, STROKES);
    await tick();
    const req = http.expectOne(`${BASE}/assignments/tarea-9/sheet`);
    expect(req.request.body).toEqual({ answer: 10, strokes: STROKES });
    req.flush({ saved: true });
    expect(await result).toBe(true);
  });

  it.each([0, 401, 422, 503])('ante un %i devuelve false sin lanzar ni asustar', async (status) => {
    const { service, http } = setup();
    const result = service.savePractice('perfil-1', 't', 1, null, STROKES);
    await tick();
    const req = http.expectOne(`${BASE}/exercises/sheet`);
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush({}, { status, statusText: 'x' });
    expect(await result).toBe(false);
  });

  it('pregunta si hay vínculo con GET y la sesión; ante cualquier fallo dice que no', async () => {
    const { service, http } = setup();
    const yes = service.enabled('perfil-1');
    await tick();
    const req = http.expectOne(`${BASE}/sheets/enabled`);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer sesion-tutor');
    req.flush({ enabled: true });
    expect(await yes).toBe(true);

    const no = service.enabled('perfil-1');
    await tick();
    http.expectOne(`${BASE}/sheets/enabled`).flush({}, { status: 503, statusText: 'x' });
    expect(await no).toBe(false);
  });

  it('sin sesión no pregunta ni guarda', async () => {
    const { service, http } = setup(null);
    expect(await service.enabled('perfil-1')).toBe(false);
    http.expectNone(`${BASE}/sheets/enabled`);
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.saveTask('perfil-1', 'tarea', 1, STROKES)).toBe(false);
    http.expectNone(`${BASE}/assignments/tarea/sheet`);
  });
});
