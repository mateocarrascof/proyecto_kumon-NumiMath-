import { WeekStat } from '../report/report.port';

export interface TopicProgress {
  topic: string;
  label: string;
  total: number;
  correct: number;
}

export interface RecentAttempt {
  topic: string;
  label: string;
  correct: boolean;
  answeredAt: string;
}

export interface Progress {
  total: number;
  correct: number;
  /** Aciertos seguidos (los últimos intentos). */
  streak: number;
  /** Días seguidos respondiendo al menos un ejercicio, según la fecha local del dispositivo. */
  dailyStreak: number;
  /** Si ya respondió algún ejercicio hoy (fecha local). */
  practicedToday: boolean;
  byTopic: TopicProgress[];
  recent: RecentAttempt[];
  /** Evolución (CU-A23): 8 semanas que terminan hoy, de la más antigua a la actual. */
  weeks: WeekStat[];
}

/** Puerto del progreso: el cálculo vive en el servidor; la app solo lo muestra. */
export abstract class ProgressPort {
  abstract get(studentId: string): Promise<Progress>;
}
