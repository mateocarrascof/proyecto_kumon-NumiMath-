/**
 * Mensajes de error de las pantallas del NIÑO (práctica, progreso).
 * Reglas: cortos, sin culpa y sin palabras técnicas ("servidor", "sesión", "acceso"). Si el niño
 * no puede resolverlo solo, se le pide ayuda a un adulto. Las pantallas del tutor (login, PIN,
 * panel) tienen sus propios mensajes, pensados para un adulto.
 */
export const KID_ERRORS = {
  session: 'Pide ayuda a un adulto para volver a entrar.',
  forbidden: 'Ahora no se puede entrar aquí. Pide ayuda a un adulto.',
  network: 'No pude conectarme. Intenta en un rato o pide ayuda a un adulto.',
  unavailable: 'Algo no funcionó. Intenta de nuevo en un momento.',
} as const;

export type KidErrorCode = keyof typeof KID_ERRORS;
