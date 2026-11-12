import { Level } from '../practice/practice.port';
import {
  LocalProgress,
  applyAnswer,
  canonical,
  matches,
  simplified,
  solutionHash,
} from './offline-grading';

function block(level: Level, right: number): LocalProgress {
  let p: LocalProgress = { level, blockDone: 0, blockCorrect: 0, mastered: false };
  for (let i = 0; i < 10; i++) p = applyAnswer(p, level, i < right);
  return p;
}

describe('corrección provisional sin conexión', () => {
  it('forma canónica igual a la del servidor (fracciones simplificadas)', () => {
    expect(canonical(12)).toBe('12');
    expect(canonical(6, 10)).toBe('3/5');
    expect(canonical(0, 4)).toBe('0/1');
  });

  it('el hash es SHA-256 de "sal|forma canónica" (el mismo que calcula el servidor)', async () => {
    // Valores calculados con hashlib de Python (como `solution_hash` del servidor).
    expect(await solutionHash('abc', '12')).toBe(
      '1da84ff5fb96deec1b3c7529b63b5f88302c70c21ecaf58780c7f889ed415ac2',
    );
    expect(await solutionHash('sal', '3/5')).toBe(
      'd20106b268f43718ada8e314664202d11ebeb031c52aa894cbfe543f9012e10b',
    );
    expect(await solutionHash('abd', '12')).not.toBe(await solutionHash('abc', '12'));
  });

  it('acepta la respuesta exacta y las fracciones equivalentes; rechaza las otras', async () => {
    const hash = await solutionHash('sal', '3/5');
    expect(await matches('sal', hash, 3, 5)).toBe(true);
    expect(await matches('sal', hash, 6, 10)).toBe(true);
    expect(await matches('sal', hash, 3, 4)).toBe(false);
    const n = await solutionHash('sal', '42');
    expect(await matches('sal', n, 42)).toBe(true);
    expect(await matches('sal', n, 43)).toBe(false);
  });

  it('muestra la forma simple de una fracción correcta sin simplificar', () => {
    expect(simplified(6, 10)).toEqual({ num: 3, den: 5 });
    expect(simplified(3, 5)).toBeUndefined();
  });
});

describe('regla de bloques de 10 (copia de levels.py, mismos casos)', () => {
  it.each([
    [1, 10, 2],
    [1, 8, 2],
    [1, 7, 1],
    [2, 5, 2],
    [2, 4, 1],
    [2, 0, 1],
    [1, 0, 1],
    [3, 10, 3],
    [3, 4, 2],
  ] as [Level, number, Level][])('nivel %i con %i aciertos queda en %i', (level, right, expected) => {
    const p = block(level, right);
    expect(p.level).toBe(expected);
    expect([p.blockDone, p.blockCorrect]).toEqual([0, 0]);
  });

  it('dominar es 8 o más en el nivel 3', () => {
    expect(block(3, 8).mastered).toBe(true);
    expect(block(3, 7).mastered).toBe(false);
  });

  it('un ejercicio emitido en otro nivel no cuenta para el bloque', () => {
    const p: LocalProgress = { level: 2, blockDone: 3, blockCorrect: 2, mastered: false };
    expect(applyAnswer(p, 1, true)).toEqual(p);
  });
});
