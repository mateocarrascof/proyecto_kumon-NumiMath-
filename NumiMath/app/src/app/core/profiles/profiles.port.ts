export type Grade = 1 | 2 | 3 | 4;

/** Perfil de un niño o niña: solo apodo y curso (CLAUDE.md). Sin credenciales ni datos personales. */
export interface Profile {
  id: string;
  nickname: string;
  grade: Grade;
  blocked: boolean;
  /** CU-A9: el tutor activó el recordatorio de racha (apagado por defecto). */
  streakReminder?: boolean;
}

/** `duplicate`: el tutor ya tiene un perfil con ese apodo en ese curso (ADR 0005). */
export type CreateFailure = 'limit' | 'consent' | 'nickname' | 'duplicate' | 'network' | 'unknown';

export type CreateResult = { ok: true; profile: Profile } | { ok: false; reason: CreateFailure };

/** Borrar: `pin` = falta el PIN o venció; `not_found` = ya no existe. */
export type RemoveResult = 'ok' | 'pin' | 'not_found' | 'error';

export const MAX_PROFILES = 5;
export const NICKNAME_MAX = 30;

/**
 * Apodo: UNA sola palabra, solo letras (tildes, ü y ñ), de 1 a 30. Sin espacios, números ni
 * símbolos, para que no quepan apellidos, teléfonos ni correos (CLAUDE.md). La base aplica la misma
 * regla (trigger students_nickname_format, migración 20261118120000).
 */
export const NICKNAME_PATTERN = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{1,30}$/;

/** Limpia el apodo como se guarda: forma NFC (tildes compuestas) y sin espacios al borde. */
export function cleanNickname(nickname: string): string {
  return nickname.normalize('NFC').trim();
}

export function isValidNickname(nickname: string): boolean {
  return NICKNAME_PATTERN.test(nickname);
}

export abstract class ProfilesPort {
  abstract list(): Promise<Profile[]>;
  abstract create(nickname: string, grade: Grade): Promise<CreateResult>;
  /** Solo desde la zona del tutor: pasa por la API con el token del PIN. */
  abstract remove(id: string): Promise<RemoveResult>;
}
