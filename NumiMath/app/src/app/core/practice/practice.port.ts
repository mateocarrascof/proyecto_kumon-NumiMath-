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
  /** CU-A2: la habilidad aún no tiene intentos y se puede ofrecer la prueba corta inicial. */
  diagnosticAvailable?: boolean;
  /** CU-A12: sin conexión, ya no quedan ejercicios guardados de esta habilidad. */
  exhausted?: boolean;
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
  /** CU-A12: ejercicio del lote sin conexión (se corrige en el dispositivo y queda en cola). */
  offline?: boolean;
}

export interface AnswerResult {
  correct: boolean;
  /**
   * Respuesta correcta. Falta sin conexión: el lote guarda la solución en hash (ADR 0002), así
   * que el dispositivo sabe si acertó pero no puede mostrar cuál era.
   */
  correctAnswer?: number;
  /** Denominador de la respuesta correcta (solo fracciones). */
  correctAnswerDen?: number;
  /** Fracción correcta pero sin simplificar: su forma simple, para mostrarla (no es un error). */
  simplified?: { num: number; den: number };
  /** CU-A12: corrección provisional del dispositivo; el intento quedó en la cola local. */
  offline?: boolean;
}

/** Respuesta de un ejercicio del diagnóstico: se guarda en memoria y se envía al final. */
export interface DiagnosticAnswer {
  token: string;
  answer: number;
  /** Solo en fracciones (`answer` es el numerador). */
  answerDen?: number;
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
  /** Ejercicio `step` (0 a 5) del diagnóstico. El nivel lo decide el servidor según el paso. */
  abstract diagnosticExercise(studentId: string, topic: string, step: number): Promise<Exercise>;
  /** Envía las 6 respuestas juntas. Devuelve el nivel de entrada que guardó el servidor. */
  abstract submitDiagnostic(
    studentId: string,
    topic: string,
    answers: DiagnosticAnswer[],
  ): Promise<Level>;
  /** Rechaza el test inicial de un tema: no se vuelve a ofrecer nunca para este perfil. */
  abstract declineDiagnostic(studentId: string, topic: string): Promise<void>;
}
