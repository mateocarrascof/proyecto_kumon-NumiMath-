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
  streak: number;
  byTopic: TopicProgress[];
  recent: RecentAttempt[];
}

/** Puerto del progreso: el cálculo vive en el servidor; la app solo lo muestra. */
export abstract class ProgressPort {
  abstract get(studentId: string): Promise<Progress>;
}
