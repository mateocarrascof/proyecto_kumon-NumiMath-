import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { AccountPort, DeleteAccountResult } from './account.port';

@Injectable({ providedIn: 'root' })
export class HttpAccountService extends AccountPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);

  async delete(confirm: string): Promise<DeleteAccountResult> {
    const token = await this.auth.accessToken();
    if (!token) return 'error';
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.apiUrl}/v1/tutor/account/delete`,
          { confirm },
          { headers: { Authorization: `Bearer ${token}`, ...this.parental.header() } },
        ),
      );
      return 'ok';
    } catch (error) {
      if (!(error instanceof HttpErrorResponse)) return 'network';
      if (error.status === 0) return 'network';
      const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
      if (code === 'parental_required') return 'pin';
      if (code === 'confirmation_required') return 'confirm';
      return 'error';
    }
  }
}
