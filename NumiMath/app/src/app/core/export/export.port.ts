export type ExportFailure = 'no_data' | 'pin' | 'forbidden' | 'network' | 'error';
export type ExportResult = { ok: true } | { ok: false; reason: ExportFailure };

/**
 * T22: descarga del historial y las estadísticas de UN hijo en CSV (portabilidad). Zona del tutor:
 * pide el PIN. El archivo se pide por HTTP (lleva la sesión y el PIN en cabeceras) y se ofrece como
 * descarga del navegador; el servidor no lo guarda.
 */
export abstract class ExportPort {
  abstract downloadCsv(studentId: string): Promise<ExportResult>;
}
