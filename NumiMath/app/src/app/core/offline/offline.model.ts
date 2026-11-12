import { AnswerKind, Level } from '../practice/practice.port';
import { Grade } from '../profiles/profiles.port';

/**
 * Modo sin conexión (CU-A12, ADR 0002, opción A). Lo que se guarda en el dispositivo.
 *
 * Del niño solo queda en el teléfono: el id del perfil (UUID), su apodo y curso (para elegir
 * perfil sin internet) y sus respuestas en la cola. Nada de esto va a la IA. Sin cifrado: datos
 * mínimos y de vida corta (decisión 6 del ADR).
 */

/** Estado de una habilidad en el lote. Parte del progreso real del servidor al descargar. */
export interface OfflineTopic {
  id: string;
  label: string;
  module: string;
  grade: number;
  level: Level;
  blockDone: number;
  /** Aciertos del bloque en curso: hacen falta para repetir la regla del bloque de 10. */
  blockCorrect: number;
  blockSize: number;
  mastered: boolean;
}

export interface OfflineExercise {
  /** Token firmado (dominio del lote). La app no lo lee: lo guarda y lo envía al sincronizar. */
  token: string;
  topic: string;
  level: Level;
  text: string;
  answerKind: AnswerKind;
  /** SHA-256(sal | forma canónica). Solo para la corrección provisional; NO es seguridad. */
  solutionHash: string;
  used: boolean;
}

export interface OfflineBatch {
  studentId: string;
  salt: string;
  /** Segundos desde 1970 (como el servidor). */
  issuedAt: number;
  expiresAt: number;
  topics: OfflineTopic[];
  exercises: OfflineExercise[];
}

/**
 * Un intento hecho sin conexión, en cola hasta que CU-A13 lo envíe. `correct` es la corrección
 * PROVISIONAL del dispositivo: el servidor la ignora y vuelve a corregir desde el token.
 */
export interface QueuedAttempt {
  /** Id local (para no duplicar al reintentar el envío). */
  id: string;
  studentId: string;
  token: string;
  topic: string;
  level: Level;
  answer: number;
  /** Solo fracciones: el denominador (`answer` es el numerador). */
  answerDen?: number;
  correct: boolean;
  /** Hora del dispositivo (ISO, UTC). */
  answeredAt: string;
  /** Fecha local del dispositivo (YYYY-MM-DD), para la racha. */
  localDate: string;
  /** Segundos desde que se mostró el ejercicio, con tope de 600 (decisión 7 del ADR). */
  durationS: number | null;
  /** Caducidad del token (segundos): pasado este plazo más 14 días, el intento se descarta. */
  expiresAt: number;
}

/**
 * De quién es la copia local y cuándo se guardó (segundos). Liga los datos guardados a UN tutor:
 * si entra otro, o la copia tiene más de 7 días, no sirve para entrar sin conexión.
 */
export interface OfflineOwner {
  tutorId: string;
  savedAt: number;
}

/**
 * La copia de perfiles vale 7 días desde la última carga con conexión (igual que el lote). Pasado
 * ese plazo no abre la app sin red y se borra (auditoría de privacidad, CU-A12).
 */
export const PROFILES_TTL_SECONDS = 7 * 24 * 3600;

/** Copia local para "¿Quién practica?" sin internet: solo apodo y curso (decisión 5 del ADR). */
export interface CachedProfile {
  id: string;
  nickname: string;
  grade: Grade;
  blocked: boolean;
}

/** Plazo para sincronizar un intento después de que caduca su token (ADR 0002, decisión 3). */
export const SYNC_GRACE_SECONDS = 14 * 24 * 3600;

/** Tope del tiempo por ejercicio: lo que dura un ejercicio en línea (decisión 7 del ADR). */
export const MAX_DURATION_S = 600;
