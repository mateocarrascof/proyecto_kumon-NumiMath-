export interface Topic {
  id: string;
  label: string;
}

export interface Exercise {
  /** Token firmado por el servidor; la app solo lo devuelve al responder. */
  token: string;
  topic: string;
  text: string;
  expiresIn: number;
}

export interface AnswerResult {
  correct: boolean;
  correctAnswer: number;
}

export type PracticeErrorCode =
  | 'expired'
  | 'session'
  | 'already_answered'
  | 'forbidden'
  | 'unavailable'
  | 'network';

export class PracticeError extends Error {
  constructor(readonly code: PracticeErrorCode) {
    super(code);
  }
}

/** Puerto de la práctica: la corrección y el registro viven en el servidor (FastAPI). */
export abstract class PracticePort {
  abstract topics(studentId: string): Promise<Topic[]>;
  abstract newExercise(studentId: string, topic: string): Promise<Exercise>;
  abstract answer(studentId: string, token: string, answer: number): Promise<AnswerResult>;
}
