export interface TeacherProfile {
  name: string;
  linkCode: string;
}

export type TeacherProfileResult =
  | { ok: true; profile: TeacherProfile }
  | { ok: false; reason: 'forbidden' | 'network' | 'error' };

/**
 * Zona del docente. Hoy solo su propio perfil (nombre y código de vínculo). Nunca datos de niños:
 * un docente solo ve a un niño con un vínculo activo hecho por el tutor, y eso llega en otro caso.
 */
export abstract class TeacherPort {
  abstract getProfile(): Promise<TeacherProfileResult>;
}
