/** Un trazo de la hoja del papel, en coordenadas de la hoja (1200 x 900): solo datos vectoriales. */
export interface SheetStroke {
  eraser: boolean;
  color: string;
  width: number;
  points: [number, number][];
}

/**
 * Guardar la hoja del papel (CU-A22) de un ejercicio YA respondido. Devuelve `true` solo si quedó
 * guardada. Sin docente vinculado, sin red o ante cualquier error devuelve `false` y NUNCA lanza:
 * el ejercicio ya se registró y el niño no ve ningún error. No hay cola sin conexión: sin red no se
 * guarda (límite conocido, docs/plan-docente-admin.md).
 */
export abstract class SheetsPort {
  /**
   * ¿Hay un docente vinculado cuyo texto de autorización cubre las hojas? Se pregunta ANTES de subir
   * trazos: sin vínculo (o sin respuesta) devuelve `false` y el dibujo no sale del dispositivo.
   */
  abstract enabled(studentId: string): Promise<boolean>;

  abstract savePractice(
    studentId: string,
    token: string,
    answer: number,
    answerDen: number | null,
    strokes: SheetStroke[],
  ): Promise<boolean>;

  abstract saveTask(
    studentId: string,
    assignmentId: string,
    answer: number,
    strokes: SheetStroke[],
  ): Promise<boolean>;
}
