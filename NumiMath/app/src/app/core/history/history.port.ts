/** Un intento de práctica del hijo, visto por el tutor (T5): habilidad, resultado, nivel y hora. */
export interface AttemptEntry {
  label: string;
  tutorTask: boolean;
  correct: boolean;
  level: number;
  /** ISO con hora. */
  answeredAt: string;
}

export interface AttemptsPage {
  items: AttemptEntry[];
  hasMore: boolean;
  nextOffset: number | null;
}

export type HistoryFailure = 'pin' | 'forbidden' | 'network' | 'error';

export type AttemptsResult = { ok: true; page: AttemptsPage } | { ok: false; reason: HistoryFailure };

/** Historial de ejercicios del hijo para el tutor (T5), paginado. Zona del tutor: pide el PIN. */
export abstract class HistoryPort {
  abstract page(studentId: string, offset: number): Promise<AttemptsResult>;
}
