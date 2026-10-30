export type Grade = 1 | 2 | 3 | 4;

/** Perfil de un niño o niña: solo apodo y curso (CLAUDE.md). Sin credenciales ni datos personales. */
export interface Profile {
  id: string;
  nickname: string;
  grade: Grade;
  blocked: boolean;
}

export type CreateFailure = 'limit' | 'consent' | 'nickname' | 'network' | 'unknown';

export type CreateResult = { ok: true; profile: Profile } | { ok: false; reason: CreateFailure };

/** Borrar: `pin` = falta el PIN o venció; `not_found` = ya no existe. */
export type RemoveResult = 'ok' | 'pin' | 'not_found' | 'error';

export const MAX_PROFILES = 5;
export const NICKNAME_MAX = 30;

export abstract class ProfilesPort {
  abstract list(): Promise<Profile[]>;
  abstract create(nickname: string, grade: Grade): Promise<CreateResult>;
  /** Solo desde la zona del tutor: pasa por la API con el token del PIN. */
  abstract remove(id: string): Promise<RemoveResult>;
}
