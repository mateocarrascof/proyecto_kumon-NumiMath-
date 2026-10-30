import { Injectable, InjectionToken, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import {
  ExplanationError,
  ExplanationPort,
  ExplanationRequest,
} from './explanation.port';
import { SseParser } from './sse-parser';

/** `fetch` inyectable (las pruebas lo reemplazan). */
export const FETCH = new InjectionToken<typeof fetch>('fetch', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

/** Largo máximo de un mensaje del servidor que se muestra al niño. */
const MAX_MESSAGE = 300;

function childMessage(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_MESSAGE) : undefined;
}

/**
 * `POST /v1/students/{id}/explanations` con fetch + ReadableStream, porque EventSource no deja
 * enviar `Authorization`. El texto recibido no se guarda en ningún lado: solo se entrega a
 * `onChunk`.
 */
@Injectable({ providedIn: 'root' })
export class HttpExplanationService extends ExplanationPort {
  private readonly auth = inject(AuthPort);
  private readonly fetch = inject(FETCH);

  async explain(
    studentId: string,
    request: ExplanationRequest,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const token = await this.auth.accessToken();
    if (signal.aborted) throw new ExplanationError('aborted');
    if (!token) throw new ExplanationError('unavailable');

    let response: Response;
    try {
      response = await this.fetch(
        `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/explanations`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          // Se copian solo estos dos campos: nada más del objeto puede viajar por error.
          body: JSON.stringify({ topic: request.topic, exercise: request.exercise }),
          signal,
          cache: 'no-store',
        },
      );
    } catch {
      throw new ExplanationError(signal.aborted ? 'aborted' : 'unavailable');
    }

    if (!response.ok) throw await this.httpError(response);
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('text/event-stream') || !response.body) {
      throw new ExplanationError('unavailable');
    }
    await this.read(response.body, onChunk, signal);
  }

  private async httpError(response: Response): Promise<ExplanationError> {
    if (response.status === 429) return new ExplanationError('quota');
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: unknown; message?: unknown };
      } | null;
      if (body?.error?.code === 'input_rejected') {
        return new ExplanationError('rejected', childMessage(body.error.message));
      }
    }
    return new ExplanationError('unavailable');
  }

  private async read(
    body: ReadableStream<Uint8Array>,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch {
          throw new ExplanationError(signal.aborted ? 'aborted' : 'interrupted');
        }
        if (signal.aborted) throw new ExplanationError('aborted');
        const text = result.done
          ? decoder.decode() + '\n\n' // cierra un último evento sin línea en blanco
          : decoder.decode(result.value, { stream: true });
        for (const event of parser.push(text)) {
          if (this.handle(event.event, event.data, onChunk)) return;
        }
        if (result.done) throw new ExplanationError('interrupted'); // terminó sin "done"
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  /** `true` si la explicación terminó bien. */
  private handle(event: string, data: string, onChunk: (text: string) => void): boolean {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new ExplanationError('interrupted');
    }
    if (event === 'done') return true;
    if (event === 'error') throw new ExplanationError('interrupted', childMessage(payload['message']));
    if (event === 'chunk' && typeof payload['text'] === 'string') onChunk(payload['text']);
    return false;
  }
}
