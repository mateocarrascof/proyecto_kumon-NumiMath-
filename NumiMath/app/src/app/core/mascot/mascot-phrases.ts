/**
 * Frases fijas de Numi. Están escritas en la app: nunca las genera la IA.
 * Reglas: positivas, aptas para 6–10 años, sin pedir datos y sin nombrar al niño.
 * Numi COMPLEMENTA lo que dice la pantalla, no lo repite: el aviso de la práctica ya dice "Casi…",
 * "¡Medalla!", "¡Subiste de nivel!", "¡Dominaste …!" o "¡Terminaste tus tareas!".
 * Sin género gramatical ("experto/experta"): la frase sirve para cualquier niño.
 */
export const MASCOT_PHRASES = {
  greet: ['¡Hola! ¿Jugamos?', '¡Vamos a practicar!', '¡Qué bueno verte!'],
  correct: ['¡Genial!', '¡Qué crack!', '¡Lo lograste!', '¡Súper bien!'],
  wrong: ['¡Tú puedes!', '¡Así se aprende!', '¡Sigue así, vas bien!'],
  thinking: ['Hmm… veamos', 'Pensando un ejercicio…'],
  medal: ['¡Qué racha!', '¡Qué bien lo hiciste!'],
  levelUp: ['¡Ahora un poco más difícil!', '¡Vas muy bien, sube el reto!'],
  progress: ['¡Mira cuánto avanzaste!'],
  mastered: ['¡Esto ya lo manejas!', '¡Qué orgullo!'],
  tasksDone: ['¡Bien hecho!', '¡Listo por hoy!'],
  recover: ['Calma, esto tiene arreglo.'],
} as const;

export type PhraseKind = keyof typeof MASCOT_PHRASES;

export function pickPhrase(kind: PhraseKind, random: () => number = Math.random): string {
  const list = MASCOT_PHRASES[kind];
  return list[Math.floor(random() * list.length) % list.length];
}
