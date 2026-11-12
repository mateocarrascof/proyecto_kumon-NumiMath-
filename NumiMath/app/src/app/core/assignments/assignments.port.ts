/** Tarea pendiente tal como la ve el niño: sin la respuesta. */
export interface PendingAssignment {
  id: string;
  text: string;
}

/** Tarea ya hecha tal como la ve el niño: solo si acertó, sin la respuesta. */
export interface DoneAssignment {
  id: string;
  text: string;
  status: 'correct' | 'wrong';
}

export interface KidTasks {
  pending: PendingAssignment[];
  done: DoneAssignment[];
}

export type AssignmentStatus = 'pending' | 'correct' | 'wrong';

/** Tarea tal como la ve el tutor. */
export interface Assignment {
  id: string;
  text: string;
  answer: number;
  status: AssignmentStatus;
  createdAt: string;
  answeredAt: string | null;
}

export interface AssignmentResult {
  correct: boolean;
  correctAnswer: number;
}

export type TutorErrorCode =
  | 'rejected'
  | 'limit'
  | 'already_answered'
  | 'not_found'
  | 'parental_required'
  | 'session'
  | 'forbidden'
  | 'unavailable'
  | 'network';

/** Error de la zona del tutor. `message` trae el texto del servidor cuando es para el adulto. */
export class TutorError extends Error {
  constructor(
    readonly code: TutorErrorCode,
    readonly serverMessage = '',
  ) {
    super(code);
  }
}

/** Ejercicios propios del tutor. El filtrado del texto y la corrección viven en el servidor. */
export abstract class AssignmentsPort {
  /** Para el niño (sin PIN): pendientes y hechas, nunca la respuesta. */
  abstract forKid(studentId: string): Promise<KidTasks>;
  /** Para el tutor (con PIN): todas, con respuesta y estado. */
  abstract all(studentId: string): Promise<Assignment[]>;
  abstract create(studentId: string, text: string, answer: number): Promise<void>;
  /** T8: corrige una tarea pendiente (el filtro y el PIN reciente los exige el servidor). */
  abstract update(studentId: string, id: string, text: string, answer: number): Promise<void>;
  abstract remove(studentId: string, id: string): Promise<void>;
  /** El niño abre una tarea: ticket firmado para que el servidor mida el tiempo. */
  abstract start(studentId: string, id: string): Promise<string>;
  abstract answer(
    studentId: string,
    id: string,
    answer: number,
    ticket?: string | null,
  ): Promise<AssignmentResult>;
}
