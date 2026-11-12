/**
 * CU-A9: TODOS los textos del recordatorio de racha, en un solo lugar para revisarlos (también
 * `child-safety-ai-reviewer`).
 *
 * El aviso puede verse en la pantalla de bloqueo, por eso: sin apodo, sin decir quién no practicó,
 * sin culpa, sin urgencia ni "perder la racha", y sin emoji (ADR 0003).
 */
export const STREAK_REMINDER_NOTIFICATION = {
  title: 'NumiMath',
  body: 'Numi tiene ejercicios listos para practicar un ratito.',
} as const;

/** Textos para el ADULTO en el panel del tutor. */
export const STREAK_REMINDER_PANEL = {
  label: 'Recordatorio de racha',
  help: 'Un aviso al día a las 18:00, sin el apodo, solo en los equipos donde lo actives. Apagado por defecto.',
  otherDevice: 'Activado en otro equipo. Actívalo aquí para recibir el aviso en este equipo.',
  unsupported: 'Disponible en la app del teléfono o tablet.',
  denied:
    'El teléfono no permite avisos de NumiMath. Puedes activarlos en los ajustes del teléfono.',
  pin: 'Tu sesión de adulto venció. Vuelve a escribir el PIN.',
  error: 'No pude guardar el cambio. Intenta de nuevo.',
  paused: 'Perfil en pausa: no recibe avisos.',
} as const;
