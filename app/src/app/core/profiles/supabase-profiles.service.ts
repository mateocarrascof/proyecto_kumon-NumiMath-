import { Injectable, inject } from '@angular/core';

import { AuthPort } from '../auth/auth.port';
import { SUPABASE_CLIENT } from '../auth/supabase.client';
import { CreateFailure, CreateResult, Grade, NICKNAME_MAX, Profile, ProfilesPort } from './profiles.port';

interface Row {
  id: string;
  nickname: string;
  grade: number;
  blocked_at: string | null;
}

function toProfile(row: Row): Profile {
  return {
    id: row.id,
    nickname: row.nickname,
    grade: row.grade as Grade,
    blocked: row.blocked_at !== null,
  };
}

function failureOf(message: string): CreateFailure {
  if (message.includes('student_limit_reached')) return 'limit';
  if (message.includes('consent_required')) return 'consent';
  if (message.includes('students_nickname_len')) return 'nickname';
  return 'unknown';
}

@Injectable({ providedIn: 'root' })
export class SupabaseProfilesService extends ProfilesPort {
  private readonly client = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthPort);

  async list(): Promise<Profile[]> {
    const { data, error } = await this.client
      .from('students')
      .select('id, nickname, grade, blocked_at')
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
        .select('id, nickname, grade, blocked_at')
        .single();
      if (error || !data) return { ok: false, reason: failureOf(error?.message ?? '') };
      return { ok: true, profile: toProfile(data as Row) };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      const { error } = await this.client.from('students').delete().eq('id', id);
      return !error;
    } catch {
      return false;
    }
  }
}
