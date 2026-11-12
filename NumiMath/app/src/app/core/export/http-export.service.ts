import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { ExportFailure, ExportPort, ExportResult } from './export.port';

async function failure(error: unknown): Promise<ExportFailure> {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'network';
  // Con responseType blob, el cuerpo del error también llega como Blob.
  let code: string | undefined;
  try {
    const body = error.error instanceof Blob ? JSON.parse(await error.error.text()) : error.error;
    code = (body as { error?: { code?: string } } | null)?.error?.code;
  } catch {
    code = undefined;
  }
  if (code === 'parental_required') return 'pin';
  if (code === 'no_data') return 'no_data';
  if (error.status === 401 || error.status === 403) return 'forbidden';
  return 'error';
}

@Injectable({ providedIn: 'root' })
export class HttpExportService extends ExportPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);
  private readonly parental = inject(ParentalSession);

  async downloadCsv(studentId: string): Promise<ExportResult> {
    const token = await this.auth.accessToken();
    if (!token) return { ok: false, reason: 'forbidden' };
    try {
      const blob = await firstValueFrom(
        this.http.get(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/export.csv`,
          {
            headers: { Authorization: `Bearer ${token}`, ...this.parental.header() },
            responseType: 'blob',
          },
        ),
      );
      this.save(blob);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: await failure(error) };
    }
  }

  /** Ofrece el archivo como descarga del navegador; no queda guardado en ninguna parte de la app. */
  private save(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'historial.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
