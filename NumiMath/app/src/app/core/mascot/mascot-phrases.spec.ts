import { MASCOT_PHRASES, PhraseKind, pickPhrase } from './mascot-phrases';

describe('pickPhrase', () => {
  const kinds = Object.keys(MASCOT_PHRASES) as PhraseKind[];

  it('siempre devuelve una frase de la lista pedida', () => {
    for (const kind of kinds) {
      for (const r of [0, 0.3, 0.6, 0.9999]) {
        expect(MASCOT_PHRASES[kind]).toContain(pickPhrase(kind, () => r));
      }
    }
  });

  it('ninguna frase pide datos personales', () => {
    const all = kinds
      .flatMap((k) => [...MASCOT_PHRASES[k]])
      .join(' ')
      .toLowerCase();
    for (const word of ['nombre', 'dónde', 'edad', 'correo', 'foto', 'teléfono']) {
      expect(all).not.toContain(word);
    }
  });
});

describe('frases de Numi frente a los avisos de la pantalla', () => {
  it('no repiten lo que ya dice el aviso de la práctica', () => {
    const lower = (k: PhraseKind) => MASCOT_PHRASES[k].map((p) => p.toLowerCase());
    expect(lower('wrong').some((p) => p.includes('casi'))).toBe(false);
    expect(lower('levelUp').some((p) => p.includes('subiste de nivel'))).toBe(false);
    expect(lower('mastered').some((p) => p.includes('dominaste'))).toBe(false);
    expect(lower('tasksDone').some((p) => p.includes('terminaste'))).toBe(false);
    expect(lower('medal').some((p) => p.includes('medalla'))).toBe(false);
  });

  it('caben en el globo: frases cortas', () => {
    const all = (Object.keys(MASCOT_PHRASES) as PhraseKind[]).flatMap((k) => [...MASCOT_PHRASES[k]]);
    for (const phrase of all) expect(phrase.length).toBeLessThanOrEqual(32);
  });
});

describe('frases de Numi sin género ni presión', () => {
  const all = (Object.keys(MASCOT_PHRASES) as PhraseKind[]).flatMap((k) => [...MASCOT_PHRASES[k]]);

  it('no usan artículo + sustantivo con género ("un crack", "experto")', () => {
    for (const phrase of all) {
      // Lo que califica al niño ("eres un crack", "¡un genio!"); "sube el reto" sí vale.
      expect(phrase.toLowerCase()).not.toMatch(/\beres\s+(un|una)\b|^¡(un|una)\s/);
      expect(phrase.toLowerCase()).not.toMatch(/\bexpert[oa]\b/);
    }
  });

  it('no invitan a no parar', () => {
    for (const phrase of all) expect(phrase.toLowerCase()).not.toMatch(/imparable|no pares|sigue jugando/);
  });
});
