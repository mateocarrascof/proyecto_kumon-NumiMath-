import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { optionLabel, splitEmojiRun, spokenEquation } from './games.messages';
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
    expect(await ex).toMatchObject({ token: 'tok', gameId: 'ordena-1', kind: 'order', slots: null });

    const fill = service.exercise('p1', 'completa-camino-1');
    await tick();
    http.expectOne(`${BASE}/games/completa-camino-1/exercise`).flush({
      token: 'tf', game_id: 'completa-camino-1', kind: 'fill', text: 'Completa',
      options: [{ id: 'n:2', kind: 'number', label: '2' }], slots: ['n:2', null],
    });
    expect(await fill).toMatchObject({ kind: 'fill', slots: ['n:2', null] });

    // Parte 3: lo que se dibuja encima de las opciones llega con nombres de la app.
    const scene = service.exercise('p1', 'donde-esta-1');
    await tick();
    http.expectOne(`${BASE}/games/donde-esta-1/exercise`).flush({
      token: 'ts', game_id: 'donde-esta-1', kind: 'choice', text: 'Toca',
      options: [{ id: 'e:pelota-1', kind: 'emoji', label: '⚽' }], slots: null,
      pattern: null, picto: null, measure: null,
      scene: { center: '📦', center_name: 'caja', places: [{ position: 'arriba', id: 'e:pelota-1' }] },
    });
    const blocks = service.exercise('p1', 'arma-numero-2');
    await tick();
    http.expectOne(`${BASE}/games/arma-numero-2/exercise`).flush({
      token: 'tb', game_id: 'arma-numero-2', kind: 'choice', text: '¿Qué número?', options: [],
      blocks: { tens: 4, ones: 7 },
    });
    expect(await blocks).toMatchObject({ blocks: { tens: 4, ones: 7 }, scene: null, figure: null, clock: null, scale: null });

    const drawn = service.exercise('p1', 'lee-reloj-2');
    await tick();
    http.expectOne(`${BASE}/games/lee-reloj-2/exercise`).flush({
      token: 'tc', game_id: 'lee-reloj-2', kind: 'choice', text: '¿Qué hora?',
      options: [{ id: 't:3-30', kind: 'time', label: '3:30' }],
      clock: { hour: 3, minute: 30 }, scale: 2,
      figure: { id: 'f:hexagono-verde', kind: 'figure', label: 'hexágono verde' },
    });
    expect(await drawn).toMatchObject({
      clock: { hour: 3, minute: 30 }, scale: 2,
      figure: { id: 'f:hexagono-verde', kind: 'figure', label: 'hexágono verde' },
    });
    expect(await scene).toMatchObject({
      pattern: null, picto: null, measure: null,
      scene: { center: '📦', centerName: 'caja', places: [{ position: 'arriba', id: 'e:pelota-1' }] },
    });

    const measure = service.exercise('p1', 'mide-clips-1');
    await tick();
    http.expectOne(`${BASE}/games/mide-clips-1/exercise`).flush({
      token: 'tm', game_id: 'mide-clips-1', kind: 'choice', text: '¿Cuántos?', options: [],
      measure: { thing: 'lapiz', name: 'el lápiz', unit: 'clip', glyph: '📎', length: 4 },
      picto: [{ glyph: '🍎', name: 'manzanas', count: 3 }],
      pattern: [{ id: 'f:cubo-rojo', kind: 'figure', label: 'cubo rojo' }],
    });
    expect(await measure).toMatchObject({
      scene: null,
      measure: { thing: 'lapiz', name: 'el lápiz', unit: 'clip', glyph: '📎', length: 4 },
      picto: [{ glyph: '🍎', name: 'manzanas', count: 3 }],
      pattern: [{ id: 'f:cubo-rojo', kind: 'figure', label: 'cubo rojo' }],
    });

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

  it('una respuesta con forma rara es "unavailable", no "sin conexión"', async () => {
    const { service, http } = setup();
    const list = service.list('p1');
    await tick();
    http.expectOne(`${BASE}/games`).flush({ groups: [{ module: 'x', games: 'no' }] });
    await expect(list).rejects.toEqual(new GameError('unavailable'));
    const ans = service.answer('p1', 'tok', ['n:1']);
    await tick();
    http.expectOne(`${BASE}/games/answer`).flush({ correct: true });
    await expect(ans).rejects.toEqual(new GameError('unavailable'));
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

  it('"35 __ 42": el hueco del signo se dice ("entre 35 y 42")', () => {
    expect(spokenEquation('¿Qué signo va? 35 __ 42', '')).toBe('¿Qué signo va entre 35 y 42?');
  });

  it('las horas y las unidades se leen con palabras', () => {
    expect(optionLabel({ id: 't:3-30', kind: 'time', label: '3:30' })).toBe('3 y media');
    expect(optionLabel({ id: 't:12-00', kind: 'time', label: '12:00' })).toBe('12 en punto');
    expect(optionLabel({ id: 's:cm', kind: 'symbol', label: 'cm' })).toBe('centímetros');
    expect(optionLabel({ id: 's:m', kind: 'symbol', label: 'm' })).toBe('metros');
  });

  it('el "?" suelto de "5 = 3 + ?" se dice, concordando con el objeto', () => {
    expect(spokenEquation('5 = 3 + ? ', '🍎🍎🍎')).toBe('5 es igual a 3 más ¿cuántas manzanas?');
    expect(spokenEquation('9 = 4 + ? ', '⚽⚽⚽⚽')).toBe('9 es igual a 4 más ¿cuántas pelotas?');
    expect(spokenEquation('7 − ? = 2 ', '')).toBe('7 menos ¿cuántos? es igual a 2');
    expect(spokenEquation('¿Cuál es mayor?', '')).toBeNull(); // un "?" pegado a la palabra se lee
  });

  it('dos grupos de emoji se resumen por separado (no se dice el total, que sería la respuesta)', () => {
    expect(spokenEquation('Junta las flores. ¿Cuántas hay? ', '🌸🌸🌸 🌸🌸')).toBeNull(); // sin hueco
    expect(splitEmojiRun('Junta las flores. ¿Cuántas hay? 🌸🌸🌸 🌸🌸')).toEqual({
      before: 'Junta las flores. ¿Cuántas hay? ',
      glyphs: '🌸🌸🌸 🌸🌸',
      spoken: '3 flores y 2 flores',
    });
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
