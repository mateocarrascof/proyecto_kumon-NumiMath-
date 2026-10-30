import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { PracticeError } from '../practice/practice.port';
import { localDay } from '../time/local-day';
import { Progress, ProgressPort } from './progress.port';

interface ProgressDto {
  total: number;
  correct: number;
  streak: number;
  daily_streak: number;
  practiced_today: boolean;
  by_topic: { topic: string; label: string; total: number; correct: number }[];
  recent: { topic: string; label: string; correct: boolean; answered_at: string }[];
}

@Injectable({ providedIn: 'root' })
export class HttpProgressService extends ProgressPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  async get(studentId: string): Promise<Progress> {
    const token = await this.auth.accessToken();
    if (!token) throw new PracticeError('session');
    try {
      const dto = await firstValueFrom(
        this.http.get<ProgressDto>(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/progress`,
          { headers: { Authorization: `Bearer ${token}` }, params: { today: localDay() } },
        ),
      );
      return {
        total: dto.total,
        correct: dto.correct,
        streak: dto.streak,
        dailyStreak: dto.daily_streak ?? 0,
        practicedToday: dto.practiced_today ?? false,
        byTopic: dto.by_topic,
        recent: dto.recent.map((r) => ({
          topic: r.topic,
          label: r.label,
          correct: r.correct,
          answeredAt: r.answered_at,
        })),
      };
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 401) throw new PracticeError('session');
        if (error.status === 403) throw new PracticeError('forbidden');
        if (error.status === 0) throw new PracticeError('network');
      }
      throw new PracticeError('unavailable');
    }
  }
}
