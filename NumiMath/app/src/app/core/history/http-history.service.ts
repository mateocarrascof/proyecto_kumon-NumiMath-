import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { AttemptsResult, HistoryFailure, HistoryPort } from './history.port';

interface HistoryDto {
  items: {
    label: string;
    tutor_task: boolean;
    correct: boolean;
    level: number;
    answered_at: string;
  }[];
  has_more: boolean;
  next_offset: number | null;
}

function failure(error: unknown): HistoryFailure {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'network';
  const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
  if (code === 'parental_required') return 'pin';
  if (error.status === 401 || error.status === 403) return 'forbidden';
  return 'error';
}

@Injectable({ providedIn: 'root' })
export class HttpHistoryService extends HistoryPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);

  async page(studentId: string, offset: number): Promise<AttemptsResult> {
    const token = await this.auth.accessToken();
    if (!token) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<HistoryDto>(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/history`,
          {
            headers: { Authorization: `Bearer ${token}`, ...this.parental.header() },
            params: { offset: String(offset) },
          },
        ),
      );
      return {
        ok: true,
        page: {
          items: dto.items.map((i) => ({
            label: i.label,
            tutorTask: i.tutor_task,
            correct: i.correct,
            level: i.level,
            answeredAt: i.answered_at,
          })),
          hasMore: dto.has_more,
          nextOffset: dto.next_offset,
        },
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }
}
