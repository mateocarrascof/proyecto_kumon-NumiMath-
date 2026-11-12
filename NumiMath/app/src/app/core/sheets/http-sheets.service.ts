import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { SheetStroke, SheetsPort } from './sheets.port';

@Injectable({ providedIn: 'root' })
export class HttpSheetsService extends SheetsPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  async enabled(studentId: string): Promise<boolean> {
    try {
      const token = await this.auth.accessToken();
      if (!token) return false;
      const result = await firstValueFrom(
        this.http.get<{ enabled: boolean }>(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/sheets/enabled`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
      return result.enabled === true;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: object): Promise<boolean> {
    try {
      const token = await this.auth.accessToken();
      if (!token) return false;
      const result = await firstValueFrom(
        this.http.post<{ saved: boolean }>(`${environment.apiUrl}/v1/students/${path}`, body, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      return result.saved === true;
    } catch {
      return false; // sin red, sin sesión o error del servidor: no se guarda y no se avisa
    }
  }

  savePractice(
    studentId: string,
    token: string,
    answer: number,
    answerDen: number | null,
    strokes: SheetStroke[],
  ): Promise<boolean> {
    const body = {
      token,
      answer,
      strokes,
      ...(answerDen === null ? {} : { answer_den: answerDen }),
    };
    return this.post(`${encodeURIComponent(studentId)}/exercises/sheet`, body);
  }

  saveTask(
    studentId: string,
    assignmentId: string,
    answer: number,
    strokes: SheetStroke[],
  ): Promise<boolean> {
    return this.post(
      `${encodeURIComponent(studentId)}/assignments/${encodeURIComponent(assignmentId)}/sheet`,
      { answer, strokes },
    );
  }
}
