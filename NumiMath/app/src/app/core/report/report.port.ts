export interface WeekStat {
  /** Primer día del periodo de 7 días (YYYY-MM-DD). */
  start: string;
  total: number;
  correct: number;
}

export interface TopicStat {
  topic: string;
  label: string;
  total: number;
  correct: number;
  percent: number;
  /** Tiempo típico (mediana) en segundos; null si hay pocos datos. */
  medianSeconds: number | null;
}

export type FeedbackKind = 'info' | 'strength' | 'improve' | 'habit' | 'trend';

export interface FeedbackItem {
  kind: FeedbackKind;
  text: string;
}

export interface Report {
  total: number;
  correct: number;
  percent: number;
  /** Tiempo típico (mediana) en segundos, de todos los temas; null si hay pocos datos. */
  medianSeconds: number | null;
  dailyStreak: number;
  practiceDaysLast7: number;
  /** Del periodo más antiguo al actual. */
  weeks: WeekStat[];
  byTopic: TopicStat[];
  feedback: FeedbackItem[];
}

/** Informe para el adulto. Todo se calcula en el servidor; la app solo lo muestra. */
export abstract class ReportPort {
  abstract get(studentId: string): Promise<Report>;
}
