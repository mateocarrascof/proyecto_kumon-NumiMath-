/**
 * Juegos de refuerzo (CU-A21, parte 2): lo que la app recibe del servidor. Los juegos los genera
 * y los corrige el servidor; la solución NUNCA llega antes de responder.
 */

export type GameKind = 'choice' | 'order' | 'fill';

/**
 * Opción o tarjeta. `id` es estable y lleva su tipo (`n:7`, `e:manzana-3`, `s:mayor`,
 * `f:cubo-rojo`); la app muestra `label` (en las figuras, la dibuja y `label` es su nombre y color)
 * y responde con ids.
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
  /** Habilidad del catálogo (p. ej. "1-03"): "Aprender jugando" en la práctica de ese tema. */
  skill?: string;
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
  /** Parte 3: lo que se dibuja encima de las opciones (a lo más uno por juego). */
  pattern?: GameOption[] | null;
  scene?: GameScene | null;
  picto?: GamePictoRow[] | null;
  measure?: GameMeasure | null;
  /** 2°: decenas y unidades dibujadas como bloques. */
  blocks?: { tens: number; ones: number } | null;
}

/** Escena en cruz: un objeto al centro y cada opción en una posición. */
export interface GameScene {
  center: string;
  centerName: string;
  places: { position: ScenePosition; id: string }[];
}
export type ScenePosition = 'arriba' | 'abajo' | 'izquierda' | 'derecha';

export interface GamePictoRow {
  glyph: string;
  /** En plural: "manzanas". */
  name: string;
  count: number;
}

/** Un objeto medido con clips o pasos (`length` unidades). */
export interface GameMeasure {
  thing: string;
  name: string;
  unit: string;
  glyph: string;
  length: number;
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
