import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';

import { AuthPort } from '../auth/auth.port';
import { SUPABASE_CLIENT } from '../auth/supabase.client';
import { OfflineStore } from '../offline/offline-store.port';
import { ParentalSession } from '../parental/parental-session';
import {
  CreateFailure,
  CreateResult,
  Grade,
  NICKNAME_MAX,
  Profile,
  ProfilesPort,
  RemoveResult,
} from './profiles.port';

interface Row {
  id: string;
  nickname: string;
  grade: number;
  blocked_at: string | null;
  streak_reminder?: boolean | null;
}

function toProfile(row: Row): Profile {
  return {
    id: row.id,
    nickname: row.nickname,
    grade: row.grade as Grade,
    blocked: row.blocked_at !== null,
    streakReminder: row.streak_reminder === true,
  };
}

/** Índice único de la base (ADR 0005); PostgREST responde 409 con el código 23505. */
export const DUPLICATE_NICKNAME_INDEX = 'students_tutor_grade_nickname_uk';

function failureOf(error: { message?: string; code?: string } | null): CreateFailure {
  const message = error?.message ?? '';
  if (error?.code === '23505' && message.includes(DUPLICATE_NICKNAME_INDEX)) return 'duplicate';
  if (message.includes('student_limit_reached')) return 'limit';
  if (message.includes('consent_required')) return 'consent';
  if (message.includes('students_nickname_len')) return 'nickname';
  return 'unknown';
}

@Injectable({ providedIn: 'root' })
export class SupabaseProfilesService extends ProfilesPort {
  private readonly client = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthPort);
  private readonly http = inject(HttpClient);
  private readonly parental = inject(ParentalSession);
  private readonly offlineStore = inject(OfflineStore);

  async list(): Promise<Profile[]> {
    const { data, error } = await this.client
      .from('students')
      .select('id, nickname, grade, blocked_at, streak_reminder')
      .order('nickname');
    if (error || !data) throw new Error('profiles_unavailable');
    return (data as Row[]).map(toProfile);
  }

  async create(nickname: string, grade: Grade): Promise<CreateResult> {
    const user = this.auth.user();
    const clean = nickname.trim();
    if (!user) return { ok: false, reason: 'unknown' };
    if (clean.length < 1 || clean.length > NICKNAME_MAX) return { ok: false, reason: 'nickname' };
    try {
      const { data, error } = await this.client
        .from('students')
        .insert({
          tutor_id: user.id,
          nickname: clean,
          grade,
          adult_declaration_accepted: true,
        })
        .select('id, nickname, grade, blocked_at, streak_reminder')
        .single();
      if (error || !data) return { ok: false, reason: failureOf(error) };
      return { ok: true, profile: toProfile(data as Row) };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  /**
   * El cliente ya no puede borrar en la base (migración student_delete_via_server): el borrado
   * pasa por la API, que exige el token del PIN del tutor.
   */
  async remove(id: string): Promise<RemoveResult> {
    const token = await this.auth.accessToken();
    if (!token) return 'error';
    try {
      await firstValueFrom(
        this.http.delete(`${environment.apiUrl}/v1/students/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}`, ...this.parental.header() },
        }),
      );
      // CU-A12: el lote, la cola y la copia del perfil en este dispositivo también se borran.
      await this.offlineStore.forgetStudent(id).catch(() => undefined);
      return 'ok';
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
        if (code === 'parental_required') return 'pin';
        if (error.status === 404) return 'not_found';
      }
      return 'error';
    }
  }
}
