import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { TutorError } from '../assignments/assignments.port';
import { toTutorError } from '../assignments/http-assignments.service';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { localDay } from '../time/local-day';
import { FeedbackKind, Report, ReportPort } from './report.port';

interface ReportDto {
  total: number;
  correct: number;
  percent: number;
  median_seconds?: number | null;
  daily_streak: number;
  practice_days_last_7: number;
  weeks: { start: string; total: number; correct: number }[];
  by_topic: {
    topic: string;
    label: string;
    total: number;
    correct: number;
    percent: number;
    median_seconds?: number | null;
  }[];
  feedback: { kind: FeedbackKind; text: string }[];
}

@Injectable({ providedIn: 'root' })
export class HttpReportService extends ReportPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);

  async get(studentId: string): Promise<Report> {
    const token = await this.auth.accessToken();
    if (!token) throw new TutorError('session');
    try {
      const dto = await firstValueFrom(
        this.http.get<ReportDto>(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/report`,
          {
            headers: { Authorization: `Bearer ${token}`, ...this.parental.header() },
            params: { today: localDay() },
          },
        ),
      );
      return {
        total: dto.total,
        correct: dto.correct,
        percent: dto.percent,
        medianSeconds: dto.median_seconds ?? null,
        dailyStreak: dto.daily_streak,
        practiceDaysLast7: dto.practice_days_last_7,
        weeks: dto.weeks,
        byTopic: dto.by_topic.map((t) => ({
          topic: t.topic,
          label: t.label,
          total: t.total,
          correct: t.correct,
          percent: t.percent,
          medianSeconds: t.median_seconds ?? null,
        })),
        feedback: dto.feedback,
      };
    } catch (error) {
      throw toTutorError(error);
    }
  }
}
