import { SheetStroke } from '../sheets/sheets.port';

export interface TeacherProfile {
  name: string;
  linkCode: string;
}

export type TeacherProfileResult =
  | { ok: true; profile: TeacherProfile }
  | { ok: false; reason: 'forbidden' | 'network' | 'error' };

/** Alumno vinculado: solo apodo y curso. */
export interface StudentSummary {
  studentId: string;
  nickname: string;
  grade: number;
}

/** Estado actual de una habilidad practicada (sin tiempos ni racha). */
export interface SkillState {
  code: string;
  label: string;
  module: string;
  level: number;
  blockTotal: number;
  blockCorrect: number;
  mastered: boolean;
}

export interface StudentProgress {
  nickname: string;
  grade: number;
  skills: SkillState[];
}

/** Un intento: fecha sin hora, sin duración. `exercise` es `null` en las tareas del tutor. */
export interface HistoryItem {
  label: string;
  tutorTask: boolean;
  exercise: string | null;
  correct: boolean;
  level: number;
  day: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  hasMore: boolean;
  nextOffset: number | null;
}

/** Una hoja guardada en la lista (sin trazos). */
export interface SheetItem {
  id: string;
  label: string;
  tutorTask: boolean;
  correct: boolean;
  day: string;
}

export interface SheetsPage {
  items: SheetItem[];
  hasMore: boolean;
  nextOffset: number | null;
}

/** Una hoja completa: trazos vectoriales y las respuestas (en tareas del tutor no hay su texto). */
export interface SheetDetail extends SheetItem {
  statement: string;
  childAnswer: string;
  correctAnswer: string;
  strokes: SheetStroke[];
}

/** `not_found`: sin vínculo o el niño no existe (la respuesta es la misma). */
export type TeacherReadFailure = 'not_found' | 'forbidden' | 'network' | 'error';

export type StudentsResult =
  | { ok: true; students: StudentSummary[] }
  | { ok: false; reason: TeacherReadFailure };
export type ProgressResult =
  | { ok: true; progress: StudentProgress }
  | { ok: false; reason: TeacherReadFailure };
export type HistoryResult = { ok: true; page: HistoryPage } | { ok: false; reason: TeacherReadFailure };
export type SheetsResult = { ok: true; page: SheetsPage } | { ok: false; reason: TeacherReadFailure };
export type SheetResult = { ok: true; sheet: SheetDetail } | { ok: false; reason: TeacherReadFailure };

/**
 * Zona del docente: su perfil (D3) y la LECTURA de los alumnos vinculados (D4, D5, D7, D8). Solo lectura.
 * Nunca datos de niños sin vínculo activo: el servidor responde igual que si el niño no existiera.
 */
export abstract class TeacherPort {
  abstract getProfile(): Promise<TeacherProfileResult>;
  abstract listStudents(): Promise<StudentsResult>;
  abstract getProgress(studentId: string): Promise<ProgressResult>;
  abstract getHistory(studentId: string, offset: number): Promise<HistoryResult>;
  abstract listSheets(studentId: string, offset: number): Promise<SheetsResult>;
  abstract getSheet(studentId: string, sheetId: string): Promise<SheetResult>;
}
