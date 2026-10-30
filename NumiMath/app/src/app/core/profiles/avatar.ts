/**
 * Animalito y color de cada perfil, elegidos por el id. Solo decoración: no se guarda, no es un
 * dato del niño y no sale del dispositivo. El mismo perfil siempre muestra el mismo animalito.
 */
export const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🐧', '🐢', '🦄', '🐨', '🐯', '🐰', '🐳'] as const;
export const AVATAR_TONES = ['teal', 'coral', 'lilac', 'yellow'] as const;

export interface Avatar {
  emoji: (typeof AVATARS)[number];
  tone: (typeof AVATAR_TONES)[number];
}

function hash(text: string): number {
  // FNV-1a de 32 bits: rápido y estable entre ejecuciones.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function avatarFor(id: string): Avatar {
  const h = hash(id);
  return {
    emoji: AVATARS[h % AVATARS.length],
    tone: AVATAR_TONES[Math.floor(h / AVATARS.length) % AVATAR_TONES.length],
  };
}
