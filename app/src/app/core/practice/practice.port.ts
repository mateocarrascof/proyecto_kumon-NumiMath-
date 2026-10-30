/** Dificultad del ejercicio: 1 fácil, 2 medio, 3 difícil. La decide el servidor. */
export type Level = 1 | 2 | 3;

/** Una habilidad del catálogo curricular (o las tareas del tutor, sin progreso). */
export interface Topic {
  /** Código de la habilidad, p. ej. "1-06". */
  id: string;
  label: string;
  /** Eje: "Números y operaciones", "Patrones y álgebra", "Medición"… */
  module?: string;
  grade?: number;
  /** Habilidad de un curso anterior (repaso). */
  review?: boolean;
  level?: Level;
  /** Ejercicios ya hechos del bloque en curso (de `blockSize`). */
  blockDone?: number;
  blockSize?: number;
  mastered?: boolean;
}

export type AnswerKind = 'integer' | 'fraction';

export interface Exercise {
  /** Token firmado por el servidor; la app solo lo devuelve al responder. */
  token: string;
  topic: string;
  text: string;
  level: Level;
  expiresIn: number;
  /** "fraction": se responde con numerador y denominador. */
  answerKind?: AnswerKind;
  blockDone?: number;
  blockSize?: number;
  mastered?: boolean;
}

export interface AnswerResult {
  correct: boolean;
  correctAnswer: number;
  /** Denominador de la respuesta correcta (solo fracciones). */
  correctAnswerDen?: number;
  /** Fracción correcta pero sin simplificar: su forma simple, para mostrarla (no es un error). */
  simplified?: { num: number; den: number };
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
  /** `answerDen`: solo en ejercicios de fracciones (`answer` es el numerador). */
  abstract answer(
    studentId: string,
    token: string,
    answer: number,
    answerDen?: number,
  ): Promise<AnswerResult>;
}
