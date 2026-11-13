import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { localDay } from '../time/local-day';
import {
  GameError,
  GameExercise,
  GameGroup,
  GameKind,
  GameOption,
  GameResult,
  GameMeasure,
  GamePictoRow,
  GamesPort,
  ScenePosition,
} from './games.port';

interface ListDto {
  groups: { module: string; games: { id: string; name: string; kind: GameKind }[] }[];
}

interface ExerciseDto {
  token: string;
  game_id: string;
  kind: GameKind;
  text: string;
  options: GameOption[];
  slots?: (string | null)[] | null;
  pattern?: GameOption[] | null;
  scene?: {
    center: string;
    center_name: string;
    places: { position: ScenePosition; id: string }[];
  } | null;
  picto?: GamePictoRow[] | null;
  measure?: GameMeasure | null;
  blocks?: { tens: number; ones: number } | null;
}

interface AnswerDto {
  correct: boolean;
  correct_answer: string[];
  message: string;
}

/** Juegos por FastAPI con el JWT del tutor (CU-A21). Sin caché ni modo sin conexión. */
@Injectable({ providedIn: 'root' })
export class HttpGamesService extends GamesPort {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthPort);

  private url(studentId: string, path: string): string {
    return `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}${path}`;
  }

  private async call<T>(request: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    const token = await this.auth.accessToken();
    if (!token) throw new GameError('session');
    try {
      return await request({ Authorization: `Bearer ${token}` });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): GameError {
    if (error instanceof GameError) return error;
    // "Sin conexión" solo cuando de verdad no hubo respuesta; cualquier otro error inesperado
    // (p. ej. una respuesta con forma rara) no debe decirle al niño que no hay internet.
    if (!(error instanceof HttpErrorResponse)) return new GameError('unavailable');
    if (error.status === 0) return new GameError('network');
    const code = (error.error as { error?: { code?: string } } | null)?.error?.code;
    if (code === 'game_grade_not_allowed') return new GameError('grade');
    if (error.status === 409 || code === 'already_answered') return new GameError('already_answered');
    if (code === 'exercise_invalid') return new GameError('expired');
    if (error.status === 401) return new GameError('session');
    if (error.status === 403) return new GameError('forbidden');
    if (error.status === 404) return new GameError('not_found');
    return new GameError('unavailable');
  }

  list(studentId: string): Promise<GameGroup[]> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(this.http.get<ListDto>(this.url(studentId, '/games'), { headers }));
      // Falla cerrado: una lista con forma rara no se muestra.
      if (!dto || !Array.isArray(dto.groups) || !dto.groups.every((g) => Array.isArray(g?.games))) {
        throw new GameError('unavailable');
      }
      return dto.groups.map((g) => ({ module: g.module, games: g.games.map((x) => ({ ...x })) }));
    });
  }

  exercise(studentId: string, gameId: string): Promise<GameExercise> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<ExerciseDto>(
          this.url(studentId, `/games/${encodeURIComponent(gameId)}/exercise`),
          {},
          { headers },
        ),
      );
      if (!dto || typeof dto.token !== 'string' || !Array.isArray(dto.options)) {
        throw new GameError('unavailable');
      }
      return {
        token: dto.token,
        gameId: dto.game_id,
        kind: dto.kind,
        text: dto.text,
        options: dto.options.map((o) => ({ id: o.id, kind: o.kind, label: o.label })),
        slots: Array.isArray(dto.slots) ? [...dto.slots] : null,
        pattern: Array.isArray(dto.pattern)
          ? dto.pattern.map((o) => ({ id: o.id, kind: o.kind, label: o.label }))
          : null,
        scene: dto.scene
          ? {
              center: dto.scene.center,
              centerName: dto.scene.center_name,
              places: dto.scene.places.map((p) => ({ position: p.position, id: p.id })),
            }
          : null,
        picto: Array.isArray(dto.picto)
          ? dto.picto.map((r) => ({ glyph: r.glyph, name: r.name, count: r.count }))
          : null,
        measure: dto.measure
          ? {
              thing: dto.measure.thing,
              name: dto.measure.name,
              unit: dto.measure.unit,
              glyph: dto.measure.glyph,
              length: dto.measure.length,
            }
          : null,
        blocks: dto.blocks ? { tens: dto.blocks.tens, ones: dto.blocks.ones } : null,
      };
    });
  }

  answer(studentId: string, token: string, answer: string[]): Promise<GameResult> {
    return this.call(async (headers) => {
      const dto = await firstValueFrom(
        this.http.post<AnswerDto>(
          this.url(studentId, '/games/answer'),
          // Fecha local del dispositivo: el juego suma a la racha diaria (en el servidor).
          { token, answer, local_date: localDay() },
          { headers },
        ),
      );
      if (!dto || typeof dto.correct !== 'boolean' || !Array.isArray(dto.correct_answer)) {
        throw new GameError('unavailable');
      }
      return { correct: dto.correct, correctAnswer: [...dto.correct_answer], message: dto.message };
    });
  }
}
