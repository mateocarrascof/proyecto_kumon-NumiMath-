import { GameOption } from './games.port';

/**
 * CU-A21: TODOS los textos de los juegos para el niño, en un solo lugar (para revisarlos, también
 * `child-safety-ai-reviewer`). Cortos, amables, sin culpa y sin presión de tiempo.
 */
export const GAME_TEXT = {
  play: 'Jugar',
  chooseAxis: '¿A qué quieres jugar?',
  chooseGame: 'Elige un juego',
  start: '¡Vamos!',
  next: 'Siguiente',
  seeEnd: 'Ver cómo me fue',
  ready: 'Listo',
  playAgain: 'Jugar de nuevo',
  otherGame: 'Otro juego',
  backToPractice: 'Volver a practicar',
  retry: 'Intentar otra vez',
  offline: 'Para jugar hace falta internet. Pide ayuda a un adulto.',
  grade: 'Estos juegos son para 1° y 2° básico. ¡Puedes seguir practicando!',
  error: 'Algo no salió. Intentemos otra vez.',
  already: 'Ese ya lo respondiste. Vamos con otro.',
  round: (n: number, total: number) => `Ronda ${n} de ${total}`,
  // Sin "0 de 5": a un niño de 6 años eso lo desanima.
  end: (ok: number, total: number) =>
    ok === total
      ? `¡Las ${total} rondas bien!`
      : ok === 0
        ? '¡Terminaste! Jugando se aprende.'
        : `¡Terminaste! Acertaste ${ok} de ${total}.`,
  medalNow: '¡Ganaste una medalla!',
  medals: (n: number) => `Medallas: ${n}`,
  orderSlots: 'Lugares',
  orderPool: 'Tarjetas',
  orderHelp: 'Toca una tarjeta para ponerla. Tócala otra vez para sacarla.',
  orderAnswer: 'Así quedaba:',
  correctBadge: 'Esta era',
  // Parte 3: lo que se dibuja (para el lector de pantalla).
  patternRow: (labels: string[]) => `En la fila: ${labels.join(', ')}. ¿Qué sigue?`,
  pictoCaption: 'Pictograma',
  measureClips: 'Clips',
  measureSteps: 'Pasos',
  /** `name` viene con artículo ("el lápiz"): "El lápiz y, debajo, clips en fila." */
  measureCaption: (name: string, unit: string) =>
    `${name.charAt(0).toUpperCase()}${name.slice(1)} y, debajo, ${unit}s en fila.`,
  scenePlace: {
    arriba: 'arriba',
    abajo: 'abajo',
    izquierda: 'a la izquierda',
    derecha: 'a la derecha',
  } as Record<string, string>,
  chosenBadge: 'Tu elección',
} as const;

/** Instrucción corta de Numi para cada juego (por id del servidor). */
export const GAME_INSTRUCTIONS: Record<string, string> = {
  'mayor-1': 'Toca el número más grande.',
  'mayor-2': 'Toca el número más grande.',
  'cuantos-1': 'Cuenta y toca el número.',
  'donde-hay-mas-1': 'Toca el grupo que tiene más.',
  'ordena-1': 'Pon los números de menor a mayor.',
  'ordena-2': 'Pon los números de menor a mayor.',
  'que-sigue-1': 'Mira la fila y toca el número que sigue.',
  'que-sigue-2': 'Mira la fila y toca el número que sigue.',
  'compara-signo-2': 'Toca el signo que va en el medio.',
  // CU-A21, parte 3 (1° básico).
  'completa-camino-1': 'Pon los números que faltan en el camino.',
  'descompone-1': 'Mira cuántas hay y toca cuántas faltan.',
  'junta-1': 'Junta los dos grupos y cuenta.',
  'figura-sigue-1': 'Mira la fila de figuras y toca la que sigue.',
  'toca-figura-1': 'Toca la figura que te pido.',
  'donde-esta-1': 'Mira la caja y toca lo que te pido.',
  'mide-clips-1': 'Cuenta los clips o los pasos y toca el número.',
  'pictograma-1': 'Mira el pictograma y cuenta.',
};
export const DEFAULT_INSTRUCTION = 'Mira bien y elige.';

/** Emoji del servidor → nombre en plural, para que el lector de pantalla diga "7 manzanas". */
const EMOJI_NAMES: Record<string, { glyph: string; plural: string; singular: string }> = {
  manzana: { glyph: '🍎', plural: 'manzanas', singular: 'manzana' },
  estrella: { glyph: '⭐', plural: 'estrellas', singular: 'estrella' },
  pelota: { glyph: '⚽', plural: 'pelotas', singular: 'pelota' },
  flor: { glyph: '🌸', plural: 'flores', singular: 'flor' },
};

const SYMBOL_NAMES: Record<string, string> = {
  mayor: 'mayor que',
  menor: 'menor que',
  igual: 'igual a',
};

/** Nombre de un objeto de la escena (`e:pelota-1` → "pelota"). */
export function objectName(option: GameOption): string {
  const match = /^e:([a-z]+)-1$/.exec(option.id);
  return (match && EMOJI_NAMES[match[1]]?.singular) || optionLabel(option);
}

/** Etiqueta accesible de una opción: "7", "3 manzanas", "mayor que", "cubo rojo". */
export function optionLabel(option: GameOption): string {
  const [prefix, value = ''] = option.id.split(':');
  if (prefix === 'e') {
    const match = /^([a-z]+)-(\d+)$/.exec(value);
    const names = match ? EMOJI_NAMES[match[1]] : undefined;
    if (match && names) {
      const n = Number(match[2]);
      return `${n} ${n === 1 ? names.singular : names.plural}`;
    }
  }
  if (prefix === 's' && SYMBOL_NAMES[value]) return SYMBOL_NAMES[value];
  return option.label;
}

/**
 * Separa un enunciado con emoji repetidos ("¿Cuántas manzanas hay? 🍎🍎🍎") en texto, emoji (que
 * el lector de pantalla no debe leer uno por uno) y un resumen accesible ("3 manzanas").
 */
export function splitEmojiRun(text: string): { before: string; glyphs: string; spoken: string } {
  for (const names of Object.values(EMOJI_NAMES)) {
    const start = text.indexOf(names.glyph);
    if (start < 0) continue;
    const glyphs = text.slice(start);
    if (glyphs.replaceAll(names.glyph, '').trim() !== '') continue;
    // Cada grupo (separado por un espacio) se resume por separado: "3 manzanas y 5 manzanas". Si
    // se dijera el total, el lector de pantalla diría la respuesta del juego de juntar.
    const spoken = glyphs
      .trim()
      .split(/\s+/)
      .map((group) => {
        const n = group.split(names.glyph).length - 1;
        return `${n} ${n === 1 ? names.singular : names.plural}`;
      })
      .join(' y ');
    return { before: text.slice(0, start), glyphs, spoken };
  }
  return { before: text, glyphs: '', spoken: '' };
}
