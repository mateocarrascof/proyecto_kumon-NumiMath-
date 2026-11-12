export type LegalKind = 'terms' | 'privacy' | 'adult_declaration';

export interface LegalDocument {
  id: string;
  kind: LegalKind;
  version: string;
  text: string;
  /** El texto mostrado coincide con la huella SHA-256 publicada en la base. */
  verified: boolean;
}

export type LegalBundle = Record<LegalKind, LegalDocument>;

export type ConsentResult = { ok: true } | { ok: false; reason: 'unverified' | 'network' | 'unknown' };

export type ConsentStatus = 'active' | 'missing' | 'unknown';

/**
 * Puerto del consentimiento del tutor. La implementación real usa las tablas con RLS de Supabase;
 * el plan B de la defensa usará una en memoria.
 */
export abstract class ConsentPort {
  /** Versiones vigentes con su texto. Lanza si la base o los textos no están disponibles. */
  abstract loadCurrent(): Promise<LegalBundle>;
  /**
   * Estado del consentimiento del tutor:
   * - `active`: el último evento es un "grant" de las versiones vigentes;
   * - `missing`: la base respondió y NO hay consentimiento vigente (nunca dio, revocó o cambió
   *   la versión);
   * - `unknown`: no se pudo consultar (sin red o la base no respondió). Se distingue de `missing`
   *   para no borrar los datos guardados sin conexión por una simple falla de red (CU-A12).
   */
  abstract consentStatus(): Promise<ConsentStatus>;
  abstract accept(bundle: LegalBundle): Promise<ConsentResult>;
}
