import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { OfflineStore } from '../offline/offline-store.port';
import { ParentalSession } from '../parental/parental-session';
import { ConsentRevocationPort, RevokeConsentResult } from './consent-revocation.port';

interface RevokeBody {
  status: 'revoked' | 'already_revoked';
  revoked_at: string;
  profiles_blocked: number;
  purge_after_days: number | null;
  purge_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class HttpConsentRevocationService extends ConsentRevocationPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);
  private readonly offlineStore = inject(OfflineStore);

  async revoke(): Promise<RevokeConsentResult> {
    const token = await this.auth.accessToken();
    if (!token) return { ok: false, reason: 'error' };
    try {
      const body = await firstValueFrom(
        this.http.post<RevokeBody>(
          `${environment.apiUrl}/v1/tutor/consent/revoke`,
          {},
          { headers: { Authorization: `Bearer ${token}`, ...this.parental.header() } },
        ),
      );
      // CU-A12: tras revocar no se usan datos del niño; se borran lotes, cola y copia de perfiles
      // de este dispositivo. Mejor esfuerzo: la revocación ya se hizo en el servidor.
      await this.offlineStore.clear().catch(() => undefined);
      return {
        ok: true,
        receipt: {
          revokedAt: body.revoked_at,
          alreadyRevoked: body.status === 'already_revoked',
          profilesBlocked: body.profiles_blocked,
          purgeAfterDays: body.purge_after_days,
          purgeAt: body.purge_at,
        },
      };
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0) {
        return { ok: false, reason: 'network' };
      }
      const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
      if (code === 'parental_required') return { ok: false, reason: 'pin' };
      if (code === 'no_consent') return { ok: false, reason: 'no_consent' };
      return { ok: false, reason: 'error' };
    }
  }
}
