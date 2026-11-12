import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { WeekStat } from '../report/report.port';
import { SheetStroke } from '../sheets/sheets.port';
import {
  EvolutionResult,
  HistoryResult,
  ProgressResult,
  SheetResult,
  SheetsResult,
  StudentsResult,
  TeacherPort,
  TeacherProfileResult,
  TeacherReadFailure,
} from './teacher.port';

interface StudentDto {
  student_id: string;
  nickname: string;
  grade: number;
}

interface ProgressDto {
  nickname: string;
  grade: number;
  skills: {
    code: string;
    label: string;
    module: string;
    level: number;
    block_total: number;
    block_correct: number;
    mastered: boolean;
  }[];
}

interface HistoryDto {
  items: {
    label: string;
    tutor_task: boolean;
    exercise: string | null;
    correct: boolean;
    level: number;
    day: string;
  }[];
  has_more: boolean;
  next_offset: number | null;
}

interface SheetItemDto {
  id: string;
  label: string;
  tutor_task: boolean;
  correct: boolean;
  day: string;
}

interface SheetDto extends SheetItemDto {
  statement: string;
  child_answer: string;
  correct_answer: string;
  strokes: SheetStroke[];
}

const BASE = `${environment.apiUrl}/v1/teacher`;

function failure(error: unknown): TeacherReadFailure {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'network';
  if (error.status === 404) return 'not_found';
  if (error.status === 401 || error.status === 403) return 'forbidden';
  return 'error';
}

@Injectable({ providedIn: 'root' })
export class HttpTeacherService extends TeacherPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  private async headers(): Promise<{ Authorization: string } | null> {
    const token = await this.auth.accessToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }

  async getProfile(): Promise<TeacherProfileResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const body = await firstValueFrom(
        this.http.get<{ name: string; link_code: string }>(`${BASE}/me`, { headers }),
      );
      return { ok: true, profile: { name: body.name, linkCode: body.link_code } };
    } catch (error) {
      const reason = failure(error);
      return { ok: false, reason: reason === 'network' || reason === 'forbidden' ? reason : 'error' };
    }
  }

  async listStudents(): Promise<StudentsResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const body = await firstValueFrom(
        this.http.get<{ students: StudentDto[] }>(`${BASE}/students`, { headers }),
      );
      return {
        ok: true,
        students: body.students.map((s) => ({
          studentId: s.student_id,
          nickname: s.nickname,
          grade: s.grade,
        })),
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async getProgress(studentId: string): Promise<ProgressResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<ProgressDto>(`${BASE}/students/${encodeURIComponent(studentId)}/progress`, {
          headers,
        }),
      );
      return {
        ok: true,
        progress: {
          nickname: dto.nickname,
          grade: dto.grade,
          skills: dto.skills.map((k) => ({
            code: k.code,
            label: k.label,
            module: k.module,
            level: k.level,
            blockTotal: k.block_total,
            blockCorrect: k.block_correct,
            mastered: k.mastered,
          })),
        },
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async getEvolution(studentId: string): Promise<EvolutionResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<{ weeks: WeekStat[] }>(
          `${BASE}/students/${encodeURIComponent(studentId)}/evolution`,
          { headers },
        ),
      );
      return { ok: true, weeks: dto.weeks };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async getHistory(studentId: string, offset: number): Promise<HistoryResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<HistoryDto>(`${BASE}/students/${encodeURIComponent(studentId)}/history`, {
          headers,
          params: { offset: String(offset) },
        }),
      );
      return {
        ok: true,
        page: {
          items: dto.items.map((i) => ({
            label: i.label,
            tutorTask: i.tutor_task,
            exercise: i.exercise,
            correct: i.correct,
            level: i.level,
            day: i.day,
          })),
          hasMore: dto.has_more,
          nextOffset: dto.next_offset,
        },
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async listSheets(studentId: string, offset: number): Promise<SheetsResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<{ items: SheetItemDto[]; has_more: boolean; next_offset: number | null }>(
          `${BASE}/students/${encodeURIComponent(studentId)}/sheets`,
          { headers, params: { offset: String(offset) } },
        ),
      );
      return {
        ok: true,
        page: {
          items: dto.items.map((i) => ({
            id: i.id,
            label: i.label,
            tutorTask: i.tutor_task,
            correct: i.correct,
            day: i.day,
          })),
          hasMore: dto.has_more,
          nextOffset: dto.next_offset,
        },
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async getSheet(studentId: string, sheetId: string): Promise<SheetResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<SheetDto>(
          `${BASE}/students/${encodeURIComponent(studentId)}/sheets/${encodeURIComponent(sheetId)}`,
          { headers },
        ),
      );
      return {
        ok: true,
        sheet: {
          id: dto.id,
          label: dto.label,
          tutorTask: dto.tutor_task,
          correct: dto.correct,
          day: dto.day,
          statement: dto.statement,
          childAnswer: dto.child_answer,
          correctAnswer: dto.correct_answer,
          strokes: dto.strokes,
        },
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }
}
