import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { QueuedAttempt } from './offline.model';
import { OfflineSyncError, OfflineSyncPort, SyncResult, SyncStatus } from './offline-sync.port';

const STATUSES: readonly SyncStatus[] = ['accepted', 'duplicate', 'rejected'];

@Injectable({ providedIn: 'root' })
export class HttpOfflineSyncService extends OfflineSyncPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  async send(studentId: string, attempts: QueuedAttempt[]): Promise<SyncResult[]> {
    const token = await this.auth.accessToken();
    // Sin sesión no se puede enviar todavía: es temporal, los intentos quedan en la cola.
    if (!token) throw new OfflineSyncError('retry');
    // Solo lo que el servidor necesita. `correct`, `level` y `topic` de la cola NO se envían: el
    // servidor los saca del token y vuelve a corregir (y los ignoraría igual).
    const body = {
      attempts: attempts.map((a) => ({
        id: a.id,
        token: a.token,
        answer: a.answer,
        ...(a.answerDen !== undefined ? { answer_den: a.answerDen } : {}),
        answered_at: a.answeredAt,
        local_date: a.localDate,
        duration_s: a.durationS,
      })),
    };
    let dto: { results?: unknown };
    try {
      dto = await firstValueFrom(
        this.http.post<{ results?: unknown }>(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/offline-sync`,
          body,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
    } catch (error) {
      throw this.translate(error);
    }
    return this.toResults(dto);
  }

  private translate(error: unknown): OfflineSyncError {
    if (!(error instanceof HttpErrorResponse) || error.status === 0) {
      return new OfflineSyncError('network');
    }
    // Perfil bloqueado o borrado: definitivo (decisión del dueño, CU-A13).
    if (error.status === 403 || error.status === 404) return new OfflineSyncError('forbidden');
    // 401, 429, 5xx y cualquier otro: temporal. Nunca se borran intentos por un error dudoso.
    return new OfflineSyncError('retry');
  }

  /** Falla cerrado: una respuesta con forma rara no confirma nada (los intentos se quedan). */
  private toResults(dto: { results?: unknown }): SyncResult[] {
    if (!dto || !Array.isArray(dto.results)) throw new OfflineSyncError('retry');
    return dto.results.map((r: unknown) => {
      const row = r as { id?: unknown; status?: unknown };
      if (typeof row?.id !== 'string' || !STATUSES.includes(row.status as SyncStatus)) {
        throw new OfflineSyncError('retry');
      }
      return { id: row.id, status: row.status as SyncStatus };
    });
  }
}
