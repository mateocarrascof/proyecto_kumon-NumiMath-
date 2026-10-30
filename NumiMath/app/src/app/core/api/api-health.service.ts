import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';

import { environment } from '../../../environments/environment';

export type ApiStatus = 'checking' | 'ok' | 'down';

@Injectable({ providedIn: 'root' })
export class ApiHealthService {
  private readonly http = inject(HttpClient);

  /** Nunca lanza: si no hay respuesta correcta en 5 s, el servidor se considera caído. */
  async check(): Promise<'ok' | 'down'> {
    try {
      const body = await firstValueFrom(
        this.http.get<{ status: string }>(`${environment.apiUrl}/healthz`).pipe(timeout(5000)),
      );
      return body.status === 'ok' ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  }
}
