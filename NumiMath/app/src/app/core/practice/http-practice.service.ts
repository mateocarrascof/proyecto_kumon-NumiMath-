import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import {
  AnswerResult,
  DiagnosticAnswer,
  Exercise,
  Level,
  PracticeError,
  PracticePort,
  Topic,
} from './practice.port';
import { localDay } from '../time/local-day';

interface TopicDto {
  id: string;
  label: string;
  module?: string;
  grade?: number;
  review?: boolean;
  level?: number;
  block_done?: number;
  block_size?: number;
  mastered?: boolean;
  diagnostic_available?: boolean;
}

interface ExerciseDto {
  token: string;
  topic: string;
  text: string;
  level?: number;
  expires_in: number;
  answer_kind?: string;
  block_done?: number;
  block_size?: number;
  mastered?: boolean;
}

/**
 * "Sumas hasta 1 000" → el espacio de los miles pasa a ser sin salto (U+00A0), para que el número
 * no se parta entre dos líneas ("1" arriba y "000" abajo). Solo cambia cómo se muestra.
 */
export function keepThousandsTogether(label: string): string {
  return label.replace(/(\d) (?=\d{3}(?!\d))/g, '$1 ');
}

/** Entero ≥ 0 o `undefined`. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Nivel del servidor, acotado a 1–3 (1 si falta o no es válido). */
function toLevel(value: unknown): Level {
  return value === 2 || value === 3 ? value : 1;
}

interface AnswerDto {
  correct: boolean;
  correct_answer: number;
  correct_answer_den?: number | null;
  simplified_num?: number | null;
  simplified_den?: number | null;
}

@Injectable({ providedIn: 'root' })
export class HttpPracticeService extends PracticePort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  private async call<T>(request: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    const token = await this.auth.accessToken();
    if (!token) throw new PracticeError('session');
    try {
      return await request({ Authorization: `Bearer ${token}` });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): PracticeError {
    if (!(error instanceof HttpErrorResponse)) return new PracticeError('network');
    const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
    if (error.status === 0) return new PracticeError('network');
    if (error.status === 409 || code === 'already_answered') {
      return new PracticeError('already_answered');
    }
    if (code === 'exercise_invalid') return new PracticeError('expired');
    if (error.status === 401) return new PracticeError('session');
    if (error.status === 403) return new PracticeError('forbidden');
    return new PracticeError('unavailable');
  }

  private url(studentId: string, path: string): string {
    return `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}${path}`;
  }

  topics(studentId: string): Promise<Topic[]> {
    return this.call(async (headers) => {
      const dtos = await firstValueFrom(
        this.http.get<TopicDto[]>(this.url(studentId, '/topics'), { headers }),
      );
      return dtos.map((t) => ({
        id: t.id,
        label: keepThousandsTogether(t.label),
        module: t.module,
        grade: t.grade,
        review: t.review === true,
        level: toLevel(t.level),
        blockDone: count(t.block_done) ?? 0,
        blockSize: count(t.block_size) ?? 10,
        mastered: t.mastered === true,
        diagnosticAvailable: t.diagnostic_available === true,
      }));
    });
  }

  newExercise(studentId: string, topic: string): Promise<Exercise> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<ExerciseDto>(this.url(studentId, '/exercises'), { topic }, { headers }),
      );
      return {
        token: dto.token,
        topic: dto.topic,
        text: dto.text,
        level: toLevel(dto.level),
        expiresIn: dto.expires_in,
        answerKind: dto.answer_kind === 'fraction' ? 'fraction' : 'integer',
        blockDone: count(dto.block_done) ?? 0,
        blockSize: count(dto.block_size) ?? 10,
        mastered: dto.mastered === true,
      };
    });
  }

  answer(
    studentId: string,
    token: string,
    answer: number,
    answerDen?: number,
  ): Promise<AnswerResult> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<AnswerDto>(
          this.url(studentId, '/exercises/answer'),
          // Fecha local del dispositivo para la racha diaria (sin hora ni zona horaria).
          {
            token,
            answer,
            ...(answerDen === undefined ? {} : { answer_den: answerDen }),
            local_date: localDay(),
          },
          { headers },
        ),
      );
      const result: AnswerResult = { correct: dto.correct, correctAnswer: dto.correct_answer };
      if (typeof dto.correct_answer_den === 'number') result.correctAnswerDen = dto.correct_answer_den;
      if (typeof dto.simplified_num === 'number' && typeof dto.simplified_den === 'number') {
        result.simplified = { num: dto.simplified_num, den: dto.simplified_den };
      }
      return result;
    });
  }

  diagnosticExercise(studentId: string, topic: string, step: number): Promise<Exercise> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<ExerciseDto>(
          this.url(studentId, '/diagnostic/exercises'),
          { topic, step },
          { headers },
        ),
      );
      return {
        token: dto.token,
        topic: dto.topic,
        text: dto.text,
        level: toLevel(dto.level),
        expiresIn: dto.expires_in,
        answerKind: dto.answer_kind === 'fraction' ? 'fraction' : 'integer',
      };
    });
  }

  submitDiagnostic(
    studentId: string,
    topic: string,
    answers: DiagnosticAnswer[],
  ): Promise<Level> {
    return this.call(async (headers) => {
      // Sin fecha local: el diagnóstico no suma a la racha de días.
      const body = {
        topic,
        answers: answers.map((a) => ({
          token: a.token,
          answer: a.answer,
          ...(a.answerDen === undefined ? {} : { answer_den: a.answerDen }),
        })),
      };
      const dto = await firstValueFrom(
        this.http.post<{ level?: number }>(this.url(studentId, '/diagnostic'), body, { headers }),
      );
      return toLevel(dto.level);
    });
  }
}
