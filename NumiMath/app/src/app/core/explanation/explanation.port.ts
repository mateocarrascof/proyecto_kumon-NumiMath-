/**
 * Lo ÚNICO que la app envía para pedir una explicación: el id de la habilidad y el enunciado que
 * generó el servidor. Nunca la respuesta del niño, su apodo ni su curso (el curso lo lee el
 * servidor de la base).
 */
export interface ExplanationRequest {
  topic: string;
  exercise: string;
}

/**
 * - `rejected`: el servidor no aceptó el ejercicio (422); trae su mensaje para el niño.
 * - `quota`: se acabó la cuota del día (429).
 * - `unavailable`: no se pudo empezar (red, sesión, 503…).
 * - `interrupted`: se cortó a mitad; lo ya recibido sigue siendo válido.
 * - `aborted`: la pantalla la canceló (cambio de ejercicio o salida). No se muestra.
 */
export type ExplanationErrorCode = 'rejected' | 'quota' | 'unavailable' | 'interrupted' | 'aborted';

export class ExplanationError extends Error {
  constructor(
    readonly code: ExplanationErrorCode,
    /** Mensaje del servidor pensado para el niño (solo en `rejected` e `interrupted`). */
    readonly childMessage?: string,
  ) {
    super(code);
  }
}

/** Explicación de Numi por streaming. Pasa siempre por FastAPI, nunca directo a la IA. */
export abstract class ExplanationPort {
  /**
   * Llama a `onChunk` con cada trozo de texto, en orden. Se resuelve al terminar la explicación;
   * si algo falla, se rechaza con `ExplanationError`.
   */
  abstract explain(
    studentId: string,
    request: ExplanationRequest,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}
