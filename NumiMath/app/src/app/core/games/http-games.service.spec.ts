import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { optionLabel, splitEmojiRun } from './games.messages';
import { GameError } from './games.port';
import { HttpGamesService } from './http-games.service';

const BASE = `${environment.apiUrl}/v1/students/p1`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(token: string | null = 'jwt') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => token } },
    ],
  });
  return { service: TestBed.inject(HttpGamesService), http: TestBed.inject(HttpTestingController) };
}

describe('HttpGamesService (CU-A21)', () => {
  it('lista los juegos por eje con el JWT del tutor', async () => {
    const { service, http } = setup();
    const pending = service.list('p1');
    await tick();
    const req = http.expectOne(`${BASE}/games`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt');
    req.flush({ grade: 1, groups: [{ module: 'Números', games: [{ id: 'mayor-1', name: 'Mayor', kind: 'choice' }] }] });
    expect(await pending).toEqual([{ module: 'Números', games: [{ id: 'mayor-1', name: 'Mayor', kind: 'choice' }] }]);
  });

  it('pide un ejercicio y responde con ids y la fecha local (para la racha)', async () => {
    const { service, http } = setup();
    const ex = service.exercise('p1', 'ordena-1');
    await tick();
    http.expectOne(`${BASE}/games/ordena-1/exercise`).flush({
      token: 'tok', game_id: 'ordena-1', kind: 'order', text: 'Ordena', options: [{ id: 'n:3', kind: 'number', label: '3' }],
    });
    expect(await ex).toMatchObject({ token: 'tok', gameId: 'ordena-1', kind: 'order' });

    const ans = service.answer('p1', 'tok', ['n:3']);
    await tick();
    const req = http.expectOne(`${BASE}/games/answer`);
    expect(req.request.body).toEqual({ token: 'tok', answer: ['n:3'], local_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    req.flush({ correct: false, correct_answer: ['n:3'], message: 'Casi.' });
    expect(await ans).toEqual({ correct: false, correctAnswer: ['n:3'], message: 'Casi.' });
  });

  it.each([
    [403, { error: { code: 'game_grade_not_allowed' } }, 'grade'],
    [409, { error: { code: 'already_answered' } }, 'already_answered'],
    [422, { error: { code: 'exercise_invalid' } }, 'expired'],
    [401, {}, 'session'],
    [403, { error: { code: 'forbidden' } }, 'forbidden'],
    [404, {}, 'not_found'],
    [503, {}, 'unavailable'],
  ])('traduce %i (%o) a %s', async (status, body, code) => {
    const { service, http } = setup();
    const pending = service.list('p1');
    await tick();
    http.expectOne(`${BASE}/games`).flush(body, { status, statusText: 'x' });
    await expect(pending).rejects.toEqual(new GameError(code as never));
  });

  it('sin red es "network"', async () => {
    const { service, http } = setup();
    const pending = service.list('p1');
    await tick();
    http.expectOne(`${BASE}/games`).error(new ProgressEvent('error'));
    await expect(pending).rejects.toEqual(new GameError('network'));
  });

  it('sin sesión no llama a la API', async () => {
    const { service, http } = setup(null);
    await expect(service.list('p1')).rejects.toEqual(new GameError('session'));
    http.expectNone(`${BASE}/games`);
  });
});

describe('Textos accesibles de los juegos', () => {
  it('etiqueta de opción: número, emoji resumido y símbolo con nombre', () => {
    expect(optionLabel({ id: 'n:7', kind: 'number', label: '7' })).toBe('7');
    expect(optionLabel({ id: 'e:manzana-3', kind: 'emoji', label: '🍎🍎🍎' })).toBe('3 manzanas');
    expect(optionLabel({ id: 'e:flor-1', kind: 'emoji', label: '🌸' })).toBe('1 flor');
    expect(optionLabel({ id: 's:mayor', kind: 'symbol', label: '>' })).toBe('mayor que');
  });

  it('separa los emoji repetidos del enunciado y los resume', () => {
    expect(splitEmojiRun('¿Cuántas manzanas hay? 🍎🍎🍎🍎')).toEqual({
      before: '¿Cuántas manzanas hay? ',
      glyphs: '🍎🍎🍎🍎',
      spoken: '4 manzanas',
    });
    expect(splitEmojiRun('¿Cuál es el número mayor?')).toEqual({
      before: '¿Cuál es el número mayor?',
      glyphs: '',
      spoken: '',
    });
  });
});
