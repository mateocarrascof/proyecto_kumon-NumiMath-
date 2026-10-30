import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from './parental-session';
import { ParentalPort, PinError, PinStatus } from './parental.port';

interface TokenDto {
  token: string;
  expires_in: number;
}

const CODES: Record<string, PinError['code']> = {
  pin_wrong: 'wrong',
  pin_locked: 'locked',
  pin_not_set: 'not_set',
  pin_weak: 'weak',
  pin_format: 'format',
  pin_reauth_required: 'reauth_required',
};

export function toPinError(error: unknown): PinError {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return new PinError('network');
  const body = (
    error.error as { error?: { code?: string; message?: string; remaining?: string } } | null
  )?.error;
  const code = body?.code ? CODES[body.code] : undefined;
  const message = typeof body?.message === 'string' ? body.message : '';
  if (code) {
    const remaining = body?.remaining !== undefined ? Number(body.remaining) : null;
    return new PinError(code, Number.isFinite(remaining) ? remaining : null, message);
  }
  if (error.status === 401) return new PinError('session');
  return new PinError('unavailable');
}

@Injectable({ providedIn: 'root' })
export class HttpParentalService extends ParentalPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly session = inject(ParentalSession);
  private readonly url = `${environment.apiUrl}/v1/tutor/pin`;

  private async headers(): Promise<Record<string, string>> {
    const token = await this.auth.accessToken();
    if (!token) throw new PinError('session');
    return { Authorization: `Bearer ${token}`, ...this.session.header() };
  }

  async status(): Promise<PinStatus> {
    const headers = await this.headers();
    try {
      const dto = await firstValueFrom(
        this.http.get<{ has_pin: boolean; locked_until: string | null }>(this.url, { headers }),
      );
      return { hasPin: dto.has_pin, lockedUntil: dto.locked_until ?? null };
    } catch (error) {
      throw toPinError(error);
    }
  }

  async verify(pin: string): Promise<void> {
    await this.unlock(`${this.url}/verify`, pin);
  }

  async set(pin: string): Promise<void> {
    await this.unlock(this.url, pin);
  }

  private async unlock(url: string, pin: string): Promise<void> {
    const headers = await this.headers();
    try {
      const dto = await firstValueFrom(this.http.post<TokenDto>(url, { pin }, { headers }));
      this.session.start(dto.token, dto.expires_in);
    } catch (error) {
      throw toPinError(error);
    }
  }
}
