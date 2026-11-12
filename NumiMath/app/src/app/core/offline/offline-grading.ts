import { Level } from '../practice/practice.port';

/**
 * Corrección PROVISIONAL sin conexión (ADR 0002). Lo que cuenta lo decide el servidor al
 * sincronizar: vuelve a corregir la respuesta del niño desde el token firmado e ignora este
 * resultado. Por eso manipular el lote local solo cambia lo que se ve en esta pantalla.
 */

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/**
 * Forma canónica, igual que `canonical` del servidor (`api/app/exercises/offline.py`): "12" o la
 * fracción simplificada "3/5". Se simplifica porque el servidor acepta fracciones equivalentes.
 */
export function canonical(answer: number, answerDen?: number): string {
  if (answerDen === undefined) return String(answer);
  const common = gcd(answer, answerDen) || 1;
  return `${answer / common}/${answerDen / common}`;
}

export async function solutionHash(salt: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}|${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** ¿La respuesta coincide con la solución guardada? */
export async function matches(
  salt: string,
  hash: string,
  answer: number,
  answerDen?: number,
): Promise<boolean> {
  return (await solutionHash(salt, canonical(answer, answerDen))) === hash;
}

/** Fracción correcta pero sin simplificar: su forma simple, para mostrarla (no es un error). */
export function simplified(answer: number, answerDen: number): { num: number; den: number } | undefined {
  const common = gcd(answer, answerDen);
  return common > 1 ? { num: answer / common, den: answerDen / common } : undefined;
}

// ---- Regla de bloques de 10 ------------------------------------------------------------------
// Copia de `apply_answer` (api/app/exercises/levels.py) y de `record_attempt` en la base. Aquí
// solo sirve para MOSTRAR estrellas y "¡Subiste de nivel!" sin internet; el nivel real lo
// recalcula el servidor al sincronizar (CU-A13). Si cambia la regla, cambia en los tres lugares
// (las pruebas usan la misma tabla de casos que test_levels.py).

export const BLOCK_SIZE = 10;
export const LEVEL_UP_AT = 8;
export const LEVEL_DOWN_AT = 4;

export interface LocalProgress {
  level: Level;
  blockDone: number;
  blockCorrect: number;
  mastered: boolean;
}

export function applyAnswer(progress: LocalProgress, level: Level, correct: boolean): LocalProgress {
  // Un ejercicio emitido en otro nivel (antes de un cambio) no cuenta para el bloque.
  if (level !== progress.level) return progress;
  const total = progress.blockDone + 1;
  const right = progress.blockCorrect + (correct ? 1 : 0);
  if (total < BLOCK_SIZE) return { ...progress, blockDone: total, blockCorrect: right };
  let next: Level = progress.level;
  let mastered = progress.mastered;
  if (right >= LEVEL_UP_AT) {
    if (next < 3) next = (next + 1) as Level;
    else mastered = true;
  } else if (right <= LEVEL_DOWN_AT && next > 1) {
    next = (next - 1) as Level;
  }
  return { level: next, blockDone: 0, blockCorrect: 0, mastered };
}
