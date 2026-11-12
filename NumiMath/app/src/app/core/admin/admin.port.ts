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

export type AdminFailure = 'email_taken' | 'invalid' | 'forbidden' | 'network' | 'error';

export type ListTeachersResult =
  | { ok: true; teachers: AdminTeacher[] }
  | { ok: false; reason: AdminFailure };

export type CreateTeacherResult =
  | { ok: true; teacher: CreatedTeacher }
  | { ok: false; reason: AdminFailure };

/**
 * Zona del administrador: cuentas de adultos (docentes). Nunca datos de niños ni hojas.
 * Todo pasa por FastAPI con el token del administrador.
 */
export abstract class AdminPort {
  abstract listTeachers(): Promise<ListTeachersResult>;
  abstract createTeacher(input: NewTeacher): Promise<CreateTeacherResult>;
}
