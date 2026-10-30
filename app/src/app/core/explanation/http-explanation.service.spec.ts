import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ExplanationError } from './explanation.port';
import { FETCH, HttpExplanationService } from './http-explanation.service';
import { SseParser } from './sse-parser';

const URL = `${environment.apiUrl}/v1/students/perfil-1/explanations`;
const REQUEST = { topic: '1-08', exercise: '7 + 5 = ?' };
const encoder = new TextEncoder();

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Cuerpo que entrega los trozos dados, uno por lectura. `failAt`: lectura que falla (red caída). */
function body(parts: string[], failAt = -1) {
  let i = 0;
  const cancel = vi.fn(async () => undefined);
  return {
    cancel,
    stream: {
      getReader: () => ({
        read: async () => {
          if (i === failAt) throw new TypeError('network');
          if (i >= parts.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(parts[i++]) };
        },
        cancel,
      }),
    } as unknown as ReadableStream<Uint8Array>,
  };
}

function response(
  status: number,
  init: { stream?: ReadableStream<Uint8Array>; json?: unknown; type?: string } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': init.type ?? 'text/event-stream; charset=utf-8' }),
    body: init.stream ?? null,
    json: async () => init.json,
  } as unknown as Response;
}

function setup(reply: () => Promise<Response>, token: string | null = 'jwt-del-tutor') {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => reply());
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthPort, useValue: { accessToken: async () => token } },
      { provide: FETCH, useValue: fetchMock },
    ],
  });
  return { service: TestBed.inject(HttpExplanationService), fetchMock };
}

async function run(service: HttpExplanationService, signal = new AbortController().signal) {
  const chunks: string[] = [];
  let error: unknown = null;
  try {
    await service.explain('perfil-1', REQUEST, (t) => chunks.push(t), signal);
  } catch (e) {
    error = e;
  }
  return { chunks, error: error as ExplanationError | null };
}

describe('SseParser', () => {
  it('arma eventos partidos entre lecturas y varios en una sola', () => {
    const parser = new SseParser();
    const raw = sse('chunk', { text: 'Uno.' }) + sse('chunk', { text: 'Dos.' }) + sse('done', {});
    const events = [...parser.push(raw.slice(0, 7)), ...parser.push(raw.slice(7, 40)), ...parser.push(raw.slice(40))];
    expect(events).toEqual([
      { event: 'chunk', data: '{"text":"Uno."}' },
      { event: 'chunk', data: '{"text":"Dos."}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('acepta \\r\\n aunque llegue partido, ignora comentarios y une varias líneas data', () => {
    const parser = new SseParser();
    expect(parser.push(': ping\r')).toEqual([]);
    expect(parser.push('\nevent: chunk\r\ndata: a\r\ndata: b\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([{ event: 'chunk', data: 'a\nb' }]);
  });
});

describe('HttpExplanationService', () => {
  it('envía SOLO {topic, exercise} con el JWT del tutor y entrega el texto en orden', async () => {
    const b = body([sse('chunk', { text: '¡Vamos a sumar!' }) + sse('chunk', { text: 'Son 12.' }), sse('done', {})]);
    const { service, fetchMock } = setup(async () => response(200, { stream: b.stream }));
    const extra = { ...REQUEST, nickname: 'Ana', grade: 3, answer: 11 };
    const chunks: string[] = [];
    await service.explain('perfil-1', extra, (t) => chunks.push(t), new AbortController().signal);

    expect(chunks).toEqual(['¡Vamos a sumar!', 'Son 12.']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ topic: '1-08', exercise: '7 + 5 = ?' });
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-del-tutor');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('los saltos de línea de cada paso llegan intactos', async () => {
    const b = body([
      sse('chunk', { text: 'Primero: 481 + 100 = 581\n' }) + sse('chunk', { text: 'Luego: 581 + 50 = 631\n' }),
      sse('chunk', { text: '¡Tú puedes!' }) + sse('done', {}),
    ]);
    const { service } = setup(async () => response(200, { stream: b.stream }));
    const { chunks, error } = await run(service);
    expect(error).toBeNull();
    expect(chunks).toEqual(['Primero: 481 + 100 = 581\n', 'Luego: 581 + 50 = 631\n', '¡Tú puedes!']);
  });

  it('un evento separado en dos lecturas igual llega completo', async () => {
    const raw = sse('chunk', { text: 'Hola.' }) + sse('done', {});
    const b = body([raw.slice(0, 10), raw.slice(10)]);
    const { service } = setup(async () => response(200, { stream: b.stream }));
    const { chunks, error } = await run(service);
    expect(error).toBeNull();
    expect(chunks).toEqual(['Hola.']);
  });

  it('un evento error a mitad conserva lo recibido y trae el mensaje del servidor', async () => {
    const b = body([
      sse('chunk', { text: 'Primero.' }),
      sse('error', { code: 'output_blocked', message: 'Ups, no puedo seguir con esta explicación.' }),
    ]);
    const { service } = setup(async () => response(200, { stream: b.stream }));
    const { chunks, error } = await run(service);
    expect(chunks).toEqual(['Primero.']);
    expect(error?.code).toBe('interrupted');
    expect(error?.childMessage).toBe('Ups, no puedo seguir con esta explicación.');
  });

  it('si el stream termina sin "done" es un corte', async () => {
    const b = body([sse('chunk', { text: 'Primero.' })]);
    const { service } = setup(async () => response(200, { stream: b.stream }));
    const { chunks, error } = await run(service);
    expect(chunks).toEqual(['Primero.']);
    expect(error?.code).toBe('interrupted');
    expect(error?.childMessage).toBeUndefined();
  });

  it('si la red se cae a mitad es un corte', async () => {
    const b = body([sse('chunk', { text: 'Primero.' })], 1);
    const { service } = setup(async () => response(200, { stream: b.stream }));
    const { chunks, error } = await run(service);
    expect(chunks).toEqual(['Primero.']);
    expect(error?.code).toBe('interrupted');
  });

  it('422 input_rejected trae el mensaje del servidor para el niño', async () => {
    const json = { error: { code: 'input_rejected', message: 'Yo te ayudo con matemáticas.', reason: 'off_topic' } };
    const { service } = setup(async () => response(422, { json, type: 'application/json' }));
    const { error } = await run(service);
    expect(error?.code).toBe('rejected');
    expect(error?.childMessage).toBe('Yo te ayudo con matemáticas.');
  });

  it('otro 422 (tema no válido) no se muestra como rechazo', async () => {
    const json = { error: { code: 'invalid_request', message: 'La solicitud no es válida.' } };
    const { service } = setup(async () => response(422, { json, type: 'application/json' }));
    expect((await run(service)).error?.code).toBe('unavailable');
  });

  it('429 es cuota agotada', async () => {
    const { service } = setup(async () => response(429, { type: 'application/json' }));
    expect((await run(service)).error?.code).toBe('quota');
  });

  it.each([401, 403, 500, 503])('%i no se puede empezar', async (status) => {
    const { service } = setup(async () => response(status, { type: 'application/json' }));
    expect((await run(service)).error?.code).toBe('unavailable');
  });

  it('sin red no se puede empezar', async () => {
    const { service } = setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await run(service)).error?.code).toBe('unavailable');
  });

  it('una respuesta que no es SSE no se lee', async () => {
    const { service } = setup(async () => response(200, { type: 'text/html' }));
    expect((await run(service)).error?.code).toBe('unavailable');
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, fetchMock } = setup(async () => response(200), null);
    expect((await run(service)).error?.code).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancelar a mitad deja de leer, avisa "aborted" y suelta el cuerpo', async () => {
    const ctrl = new AbortController();
    let i = 0;
    const cancel = vi.fn(async () => undefined);
    const stream = {
      getReader: () => ({
        read: async () => {
          if (i++ === 0) return { done: false, value: encoder.encode(sse('chunk', { text: 'Uno.' })) };
          ctrl.abort();
          throw new DOMException('aborted', 'AbortError');
        },
        cancel,
      }),
    } as unknown as ReadableStream<Uint8Array>;
    const { service } = setup(async () => response(200, { stream }));
    const { chunks, error } = await run(service, ctrl.signal);
    expect(chunks).toEqual(['Uno.']);
    expect(error?.code).toBe('aborted');
    expect(cancel).toHaveBeenCalled();
  });

  it('si ya estaba cancelada cuando falla fetch, es "aborted" y no un error visible', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { service } = setup(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    expect((await run(service, ctrl.signal)).error?.code).toBe('aborted');
  });
});
