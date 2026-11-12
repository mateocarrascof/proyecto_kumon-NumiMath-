import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import {
  AdminFailure,
  AdminPort,
  AdminTeacher,
  CreateTeacherResult,
  DeleteTeacherResult,
  ListTeachersResult,
  NewTeacher,
  TeacherChanges,
  UpdateTeacherResult,
} from './admin.port';

interface TeacherDto {
  id: string;
  name: string;
  email: string;
  link_code: string;
  password?: string;
  changed?: boolean;
}

const URL = `${environment.apiUrl}/v1/admin/teachers`;

function failure(error: unknown): AdminFailure {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'network';
  if (error.status === 409) return 'email_taken';
  if (error.status === 422) return 'invalid';
  if (error.status === 404) return 'not_found';
  if (error.status === 401 || error.status === 403) return 'forbidden';
  return 'error';
}

function toTeacher(dto: TeacherDto): AdminTeacher {
  return { id: dto.id, name: dto.name, email: dto.email, linkCode: dto.link_code };
}

@Injectable({ providedIn: 'root' })
export class HttpAdminService extends AdminPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  private async headers(): Promise<{ Authorization: string } | null> {
    const token = await this.auth.accessToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }

  async listTeachers(): Promise<ListTeachersResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const body = await firstValueFrom(
        this.http.get<{ teachers: TeacherDto[] }>(URL, { headers }),
      );
      return { ok: true, teachers: body.teachers.map(toTeacher) };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async createTeacher(input: NewTeacher): Promise<CreateTeacherResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(this.http.post<TeacherDto>(URL, input, { headers }));
      return { ok: true, teacher: { ...toTeacher(dto), password: dto.password ?? '' } };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async updateTeacher(id: string, changes: TeacherChanges): Promise<UpdateTeacherResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      const dto = await firstValueFrom(
        this.http.patch<TeacherDto>(`${URL}/${encodeURIComponent(id)}`, changes, { headers }),
      );
      return { ok: true, teacher: toTeacher(dto), changed: dto.changed ?? true };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }

  async deleteTeacher(id: string): Promise<DeleteTeacherResult> {
    const headers = await this.headers();
    if (!headers) return { ok: false, reason: 'forbidden' };
    try {
      await firstValueFrom(this.http.delete(`${URL}/${encodeURIComponent(id)}`, { headers }));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: failure(error) };
    }
  }
}
