import { SheetStroke } from './sheets.port';

/** Una hoja guardada en la lista del tutor (T27): sin trazos. `savedAt` es ISO con hora. */
export interface TutorSheetItem {
  id: string;
  label: string;
  tutorTask: boolean;
  correct: boolean;
  /** Ejercicio; en las tareas del tutor es siempre "Tarea del tutor". */
  statement: string;
  savedAt: string;
}

export interface TutorSheetsPage {
  items: TutorSheetItem[];
  hasMore: boolean;
  nextOffset: number | null;
  /** Todas las hojas del perfil (lo que borraría "Borrar todas"). */
  total: number;
}

/** Una hoja completa: trazos vectoriales y las dos respuestas. */
export interface TutorSheetDetail extends TutorSheetItem {
  childAnswer: string;
  correctAnswer: string;
  strokes: SheetStroke[];
}

/** `pin`: falta el PIN o venció; `not_found`: el mismo 404 sea cual sea la causa. */
export type TutorSheetsFailure = 'pin' | 'not_found' | 'forbidden' | 'network' | 'error';

export type TutorSheetsResult =
  | { ok: true; page: TutorSheetsPage }
  | { ok: false; reason: TutorSheetsFailure };
export type TutorSheetResult =
  | { ok: true; sheet: TutorSheetDetail }
  | { ok: false; reason: TutorSheetsFailure };
export type RemoveSheetsResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: TutorSheetsFailure };

/**
 * T27: el tutor titular ve y borra las hojas guardadas de UN hijo. Ver pide el PIN activo del panel;
 * borrar pide el PIN recién verificado (el componente lo verifica justo antes de llamar). Borrar es
 * definitivo y el docente deja de ver la hoja de inmediato.
 */
export abstract class TutorSheetsPort {
  abstract list(studentId: string, offset: number): Promise<TutorSheetsResult>;
  abstract get(studentId: string, sheetId: string): Promise<TutorSheetResult>;
  abstract remove(studentId: string, sheetId: string): Promise<RemoveSheetsResult>;
  abstract removeAll(studentId: string): Promise<RemoveSheetsResult>;
}
