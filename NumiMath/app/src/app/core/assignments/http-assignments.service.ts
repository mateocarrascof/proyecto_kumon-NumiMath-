import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { localDay } from '../time/local-day';
import {
  Assignment,
  AssignmentResult,
  AssignmentStatus,
  AssignmentsPort,
  KidTasks,
  TutorError,
} from './assignments.port';
import { ParentalSession } from '../parental/parental-session';

interface AssignmentDto {
  id: string;
  text: string;
  answer: number;
  status: AssignmentStatus;
  created_at: string;
  answered_at: string | null;
}

/** Traduce un error HTTP a un código de la zona del tutor. Lo comparten tareas e informe. */
export function toTutorError(error: unknown): TutorError {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return new TutorError('network');
  const body = (error.error as { error?: { code?: string; message?: string } } | null)?.error;
  const message = typeof body?.message === 'string' ? body.message : '';
  if (body?.code === 'assignment_rejected') return new TutorError('rejected', message);
  if (body?.code === 'assignment_limit') return new TutorError('limit', message);
  if (body?.code === 'parental_required') return new TutorError('parental_required');
  if (error.status === 409) return new TutorError('already_answered');
  if (error.status === 404) return new TutorError('not_found');
  if (error.status === 401) return new TutorError('session');
  if (error.status === 403) return new TutorError('forbidden');
  return new TutorError('unavailable');
}

@Injectable({ providedIn: 'root' })
export class HttpAssignmentsService extends AssignmentsPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);

  /** `tutorZone`: agrega el token del PIN (crear, borrar, lista completa). */
  private async call<T>(
    request: (headers: Record<string, string>) => Promise<T>,
    tutorZone = false,
  ): Promise<T> {
    const token = await this.auth.accessToken();
    if (!token) throw new TutorError('session');
    const extra = tutorZone ? this.parental.header() : {};
    try {
      return await request({ Authorization: `Bearer ${token}`, ...extra });
    } catch (error) {
      throw toTutorError(error);
    }
  }

  private url(studentId: string, path = ''): string {
    return `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/assignments${path}`;
  }

  forKid(studentId: string): Promise<KidTasks> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(this.http.get<KidTasks>(this.url(studentId), { headers }));
      // Solo id, texto y estado, aunque el servidor mandara algo más.
      return {
        pending: (dto.pending ?? []).map((r) => ({ id: String(r.id), text: String(r.text) })),
        done: (dto.done ?? []).map((r) => ({
          id: String(r.id),
          text: String(r.text),
          status: r.status === 'correct' ? 'correct' : 'wrong',
        })),
      };
    });
  }

  all(studentId: string): Promise<Assignment[]> {
    return this.call(async (headers) => {
      const rows = await firstValueFrom(
        this.http.get<AssignmentDto[]>(this.url(studentId, '/all'), { headers }),
      );
      return rows.map((r) => ({
        id: r.id,
        text: r.text,
        answer: r.answer,
        status: r.status,
        createdAt: r.created_at,
        answeredAt: r.answered_at,
      }));
    }, true);
  }

  create(studentId: string, text: string, answer: number): Promise<void> {
    return this.call(async (headers) => {
      await firstValueFrom(this.http.post(this.url(studentId), { text, answer }, { headers }));
    }, true);
  }

  remove(studentId: string, id: string): Promise<void> {
    return this.call(async (headers) => {
      await firstValueFrom(
        this.http.delete(this.url(studentId, `/${encodeURIComponent(id)}`), { headers }),
      );
    }, true);
  }

  start(studentId: string, id: string): Promise<string> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<{ ticket: string }>(
          this.url(studentId, `/${encodeURIComponent(id)}/start`),
          {},
          { headers },
        ),
      );
      return String(dto.ticket);
    });
  }

  answer(
    studentId: string,
    id: string,
    answer: number,
    ticket?: string | null,
  ): Promise<AssignmentResult> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<{ correct: boolean; correct_answer: number }>(
          this.url(studentId, `/${encodeURIComponent(id)}/answer`),
          ticket ? { answer, local_date: localDay(), ticket } : { answer, local_date: localDay() },
          { headers },
        ),
      );
      return { correct: dto.correct, correctAnswer: dto.correct_answer };
    });
  }
}
