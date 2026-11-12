/**
 * Juegos de refuerzo (CU-A21, parte 2): lo que la app recibe del servidor. Los juegos los genera
 * y los corrige el servidor; la solución NUNCA llega antes de responder.
 */

export type GameKind = 'choice' | 'order' | 'fill';

/**
 * Opción o tarjeta. `id` es estable y lleva su tipo (`n:7`, `e:manzana-3`, `s:mayor`); la app
 * muestra `label` y responde con ids. `kind` puede crecer (figuras SVG propias en la parte 3).
 */
export interface GameOption {
  id: string;
  kind: string;
  label: string;
}

export interface GameInfo {
  id: string;
  name: string;
  kind: GameKind;
}

export interface GameGroup {
  /** Eje temático (p. ej. "Números y operaciones"). */
  module: string;
  games: GameInfo[];
}

export interface GameExercise {
  token: string;
  gameId: string;
  kind: GameKind;
  text: string;
  /** En el orden en que se muestran. */
  options: GameOption[];
  /** Solo `fill` (completar): la secuencia con las tarjetas fijas y `null` en los huecos. */
  slots?: (string | null)[] | null;
}

export interface GameResult {
  correct: boolean;
  /** Solo después de responder: ids de la respuesta correcta. */
  correctAnswer: string[];
  /** Mensaje sin culpa que manda el servidor. */
  message: string;
}

/**
 * `network`: sin conexión (los juegos no funcionan sin internet). `grade`: el perfil no es de 1°
 * ni 2°. `already_answered`: ese ejercicio ya se respondió. `expired`: venció, se pide otro.
 */
export type GameErrorCode =
  | 'network'
  | 'grade'
  | 'already_answered'
  | 'expired'
  | 'session'
  | 'forbidden'
  | 'not_found'
  | 'unavailable';

export class GameError extends Error {
  constructor(readonly code: GameErrorCode) {
    super(code);
  }
}

export abstract class GamesPort {
  abstract list(studentId: string): Promise<GameGroup[]>;
  abstract exercise(studentId: string, gameId: string): Promise<GameExercise>;
  abstract answer(studentId: string, token: string, answer: string[]): Promise<GameResult>;
}
