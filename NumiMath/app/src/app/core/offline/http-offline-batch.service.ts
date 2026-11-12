import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { keepThousandsTogether } from '../practice/http-practice.service';
import { Level } from '../practice/practice.port';
import { OfflineBatch, OfflineExercise, OfflineTopic } from './offline.model';
import { OfflineBatchError, OfflineBatchPort } from './offline-batch.port';

interface TopicDto {
  id: string;
  label: string;
  module: string;
  grade: number;
  level: number;
  block_done: number;
  block_correct: number;
  block_size?: number;
  mastered: boolean;
}

interface ExerciseDto {
  token: string;
  topic: string;
  level: number;
  text: string;
  answer_kind?: string;
  solution_hash: string;
}

interface BatchDto {
  salt: string;
  issued_at: number;
  expires_at: number;
  topics: TopicDto[];
  exercises: ExerciseDto[];
}

function toLevel(value: unknown): Level {
  return value === 2 || value === 3 ? value : 1;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

@Injectable({ providedIn: 'root' })
export class HttpOfflineBatchService extends OfflineBatchPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  async download(studentId: string): Promise<OfflineBatch> {
    const token = await this.auth.accessToken();
    if (!token) throw new OfflineBatchError('session');
    let dto: BatchDto;
    try {
      dto = await firstValueFrom(
        this.http.post<BatchDto>(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/offline-batch`,
          {},
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );
    } catch (error) {
      throw this.translate(error);
    }
    return this.toBatch(studentId, dto);
  }

  private translate(error: unknown): OfflineBatchError {
    if (!(error instanceof HttpErrorResponse) || error.status === 0) {
      return new OfflineBatchError('network');
    }
    if (error.status === 401) return new OfflineBatchError('session');
    if (error.status === 403) return new OfflineBatchError('forbidden');
    if (error.status === 429) return new OfflineBatchError('limit');
    return new OfflineBatchError('unavailable');
  }

  /** Falla cerrado: un lote con forma rara no se guarda. */
  private toBatch(studentId: string, dto: BatchDto): OfflineBatch {
    if (
      !dto ||
      typeof dto.salt !== 'string' ||
      !Number.isInteger(dto.issued_at) ||
      !Number.isInteger(dto.expires_at) ||
      !Array.isArray(dto.topics) ||
      !Array.isArray(dto.exercises)
    ) {
      throw new OfflineBatchError('unavailable');
    }
    const topics: OfflineTopic[] = dto.topics.map((t) => ({
      id: t.id,
      label: keepThousandsTogether(t.label),
      module: t.module,
      grade: t.grade,
      level: toLevel(t.level),
      blockDone: count(t.block_done),
      blockCorrect: count(t.block_correct),
      blockSize: count(t.block_size) || 10,
      mastered: t.mastered === true,
    }));
    const exercises: OfflineExercise[] = dto.exercises
      .filter((e) => typeof e.token === 'string' && typeof e.solution_hash === 'string')
      .map((e) => ({
        token: e.token,
        topic: e.topic,
        level: toLevel(e.level),
        text: e.text,
        answerKind: e.answer_kind === 'fraction' ? 'fraction' : 'integer',
        solutionHash: e.solution_hash,
        used: false,
      }));
    return {
      studentId,
      salt: dto.salt,
      issuedAt: dto.issued_at,
      expiresAt: dto.expires_at,
      topics,
      exercises,
    };
  }
}
