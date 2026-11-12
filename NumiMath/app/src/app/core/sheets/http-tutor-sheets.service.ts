import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { SheetStroke } from './sheets.port';
import {
  RemoveSheetsResult,
  TutorSheetItem,
  TutorSheetResult,
  TutorSheetsFailure,
  TutorSheetsPort,
  TutorSheetsResult,
} from './tutor-sheets.port';

interface ItemDto {
  id: string;
  label: string;
  tutor_task: boolean;
  correct: boolean;
  statement: string;
  saved_at: string;
}

interface SheetDto extends ItemDto {
  child_answer: string;
  correct_answer: string;
  strokes: SheetStroke[];
}

function failure(error: unknown): TutorSheetsFailure {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'network';
  const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
  if (code === 'parental_required') return 'pin';
  if (error.status === 404) return 'not_found';
  if (error.status === 401 || error.status === 403) return 'forbidden';
  return 'error';
}

function item(dto: ItemDto): TutorSheetItem {
  return {
    id: dto.id,
    label: dto.label,
    tutorTask: dto.tutor_task,
    correct: dto.correct,
    statement: dto.statement,
    savedAt: dto.saved_at,
  };
}

@Injectable({ providedIn: 'root' })
export class HttpTutorSheetsService extends TutorSheetsPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);

  private url(studentId: string, rest = ''): string {
    return `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/sheets${rest}`;
  }

  private async headers(): Promise<Record<string, string> | null> {
    const token = await this.auth.accessToken();
    return token ? { Authorization: `Bearer ${token}`, ...this.parental.header() } : null;
  }

  async list(studentId: string, offset: number): Promise<TutorSheetsResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<{
          items: ItemDto[];
          has_more: boolean;
          next_offset: number | null;
          total: number;
        }>(this.url(studentId), { headers, params: { offset: String(offset) } }),
      );
      return {
        ok: true,
        page: {
          items: dto.items.map(item),
          hasMore: dto.has_more,
          nextOffset: dto.next_offset,
          total: dto.total,
        },
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async get(studentId: string, sheetId: string): Promise<TutorSheetResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.get<SheetDto>(this.url(studentId, `/${encodeURIComponent(sheetId)}`), { headers }),
      );
      return {
        ok: true,
        sheet: {
          ...item(dto),
          childAnswer: dto.child_answer,
          correctAnswer: dto.correct_answer,
          strokes: dto.strokes,
        },
      };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async remove(studentId: string, sheetId: string): Promise<RemoveSheetsResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      await firstValueFrom(
        this.http.delete(this.url(studentId, `/${encodeURIComponent(sheetId)}`), { headers }),
      );
      return { ok: true, deleted: 1 };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async removeAll(studentId: string): Promise<RemoveSheetsResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.delete<{ deleted: number }>(this.url(studentId), { headers }),
      );
      return { ok: true, deleted: dto.deleted };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }
}
