import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { sha256Hex } from '../consent/supabase-consent.service';
import { ParentalSession } from '../parental/parental-session';
import {
  AuthorizationText,
  CreateLinkResult,
  LinkFailure,
  ListLinksResult,
  LookupResult,
  RemoveLinkResult,
  TeacherLinksPort,
} from './teacher-links.port';

interface LinkedDto {
  teacher_id: string;
  name: string;
  shown_name: string;
  accepted_at: string;
}

interface LookupDto {
  teacher_name: string;
  confirmation_token: string;
  terms: { id: string; version: string; sha256: string };
}

export const AUTHORIZATION_FILE = 'autorizacion-docente.md';

function failure(error: unknown): { reason: LinkFailure; retryAfterSeconds?: number } {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return { reason: 'network' };
  const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
  if (code === 'parental_required') return { reason: 'pin' };
  if (code === 'code_not_found') return { reason: 'not_found' };
  if (code === 'already_linked') return { reason: 'already_linked' };
  if (code === 'confirmation_expired') return { reason: 'expired' };
  if (code === 'consent_required') return { reason: 'consent' };
  if (error.status === 429) {
    const seconds = Number(error.headers.get('Retry-After'));
    return { reason: 'locked', retryAfterSeconds: Number.isFinite(seconds) ? seconds : undefined };
  }
  if (error.status === 401 || error.status === 403) return { reason: 'forbidden' };
  return { reason: 'error' };
}

@Injectable({ providedIn: 'root' })
export class HttpTeacherLinksService extends TeacherLinksPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);

  private async headers(): Promise<Record<string, string> | null> {
    const token = await this.auth.accessToken();
    if (!token) return null;
    return { Authorization: `Bearer ${token}`, ...this.parental.header() };
  }

  private url(studentId: string, path: string): string {
    return `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}${path}`;
  }

  async list(studentId: string): Promise<ListLinksResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const body = await firstValueFrom(
        this.http.get<{ teachers: LinkedDto[] }>(this.url(studentId, '/teachers'), { headers }),
      );
      return {
        ok: true,
        teachers: body.teachers.map((t) => ({
          teacherId: t.teacher_id,
          name: t.name,
          shownName: t.shown_name,
          acceptedAt: t.accepted_at,
        })),
      };
    } catch (error) {
      return { ok: false, ...failure(error) };
    }
  }

  async lookup(studentId: string, code: string): Promise<LookupResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.post<LookupDto>(this.url(studentId, '/teacher-links/lookup'), { code }, { headers }),
      );
      return {
        ok: true,
        teacherName: dto.teacher_name,
        confirmationToken: dto.confirmation_token,
        terms: dto.terms,
      };
    } catch (error) {
      return { ok: false, ...failure(error) };
    }
  }

  async create(studentId: string, confirmationToken: string): Promise<CreateLinkResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.post<{ name: string }>(
          this.url(studentId, '/teacher-links'),
          { confirmation_token: confirmationToken, accept: true },
          { headers },
        ),
      );
      return { ok: true, teacherName: dto.name };
    } catch (error) {
      return { ok: false, ...failure(error) };
    }
  }

  async remove(studentId: string, teacherId: string): Promise<RemoveLinkResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      await firstValueFrom(
        this.http.delete(this.url(studentId, `/teachers/${encodeURIComponent(teacherId)}`), { headers }),
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, ...failure(error) };
    }
  }

  async loadAuthorizationText(expectedSha256: string): Promise<AuthorizationText> {
    const response = await fetch(`/assets/legal/${AUTHORIZATION_FILE}`);
    if (!response.ok) throw new Error('text_unavailable');
    const bytes = await response.arrayBuffer();
    return {
      text: new TextDecoder('utf-8').decode(bytes),
      verified: (await sha256Hex(bytes)) === expectedSha256,
    };
  }
}
