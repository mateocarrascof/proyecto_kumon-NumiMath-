import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { TeacherPort, TeacherProfileResult } from './teacher.port';

@Injectable({ providedIn: 'root' })
export class HttpTeacherService extends TeacherPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  async getProfile(): Promise<TeacherProfileResult> {
    const token = await this.auth.accessToken();
    if (!token) return { ok: false, reason: 'forbidden' };
    try {
      const body = await firstValueFrom(
        this.http.get<{ name: string; link_code: string }>(`${environment.apiUrl}/v1/teacher/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      return { ok: true, profile: { name: body.name, linkCode: body.link_code } };
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0) {
        return { ok: false, reason: 'network' };
      }
      return { ok: false, reason: error.status === 401 || error.status === 403 ? 'forbidden' : 'error' };
    }
  }
}
