/**
 * Textos de la racha diaria ("días seguidos"). Tono amable: nunca se habla de "perder" la racha
 * ni se culpa al niño; si se corta, simplemente vuelve a contar desde 1.
 */
export function daysLabel(days: number): string {
  return days === 1 ? '1 día seguido' : `${days} días seguidos`;
}

/** Frase de ánimo bajo la racha, o '' si no hace falta. */
export function dailyStreakHint(days: number, practicedToday: boolean): string {
  if (practicedToday) return '';
  if (days > 0) return '¡Practica hoy para seguir sumando!';
  return '¡Responde un ejercicio hoy para empezar tu racha de días!';
}
