export interface AdminTeacher {
  id: string;
  name: string;
  email: string;
  linkCode: string;
}

/** Alta correcta: la contraseña inicial vuelve en esta respuesta UNA sola vez, para mostrarla. */
export interface CreatedTeacher extends AdminTeacher {
  password: string;
}

export interface NewTeacher {
  name: string;
  email: string;
  password: string;
}

/** Cambios de un docente: lo que no se envía no se toca. */
export interface TeacherChanges {
  name?: string;
  email?: string;
}

export type AdminFailure =
  | 'email_taken'
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'error';

export type ListTeachersResult =
  | { ok: true; teachers: AdminTeacher[] }
  | { ok: false; reason: AdminFailure };

export type CreateTeacherResult =
  | { ok: true; teacher: CreatedTeacher }
  | { ok: false; reason: AdminFailure };

export type UpdateTeacherResult =
  | { ok: true; teacher: AdminTeacher; changed: boolean }
  | { ok: false; reason: AdminFailure };

export type DeleteTeacherResult = { ok: true } | { ok: false; reason: AdminFailure };

/**
 * Zona del administrador: cuentas de adultos (docentes). Nunca datos de niños ni hojas.
 * Todo pasa por FastAPI con el token del administrador.
 */
export abstract class AdminPort {
  abstract listTeachers(): Promise<ListTeachersResult>;
  abstract createTeacher(input: NewTeacher): Promise<CreateTeacherResult>;
  abstract updateTeacher(id: string, changes: TeacherChanges): Promise<UpdateTeacherResult>;
  abstract deleteTeacher(id: string): Promise<DeleteTeacherResult>;
}
