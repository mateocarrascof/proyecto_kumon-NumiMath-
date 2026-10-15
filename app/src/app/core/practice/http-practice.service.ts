import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import {
  AnswerResult,
  Exercise,
  PracticeError,
  PracticePort,
  Topic,
} from './practice.port';

interface ExerciseDto {
  token: string;
  topic: string;
  text: string;
  expires_in: number;
}

interface AnswerDto {
  correct: boolean;
  correct_answer: number;
}

@Injectable({ providedIn: 'root' })
export class HttpPracticeService extends PracticePort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  private async call<T>(request: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    const token = await this.auth.accessToken();
    if (!token) throw new PracticeError('forbidden');
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
    if (error.status === 401 || error.status === 403) return new PracticeError('forbidden');
    return new PracticeError('unavailable');
  }

  private url(studentId: string, path: string): string {
    return `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}${path}`;
  }

  topics(studentId: string): Promise<Topic[]> {
    return this.call((headers) =>
      firstValueFrom(this.http.get<Topic[]>(this.url(studentId, '/topics'), { headers })),
    );
  }

  newExercise(studentId: string, topic: string): Promise<Exercise> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<ExerciseDto>(this.url(studentId, '/exercises'), { topic }, { headers }),
      );
      return { token: dto.token, topic: dto.topic, text: dto.text, expiresIn: dto.expires_in };
    });
  }

  answer(studentId: string, token: string, answer: number): Promise<AnswerResult> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<AnswerDto>(
          this.url(studentId, '/exercises/answer'),
          { token, answer },
          { headers },
        ),
      );
      return { correct: dto.correct, correctAnswer: dto.correct_answer };
    });
  }
}
