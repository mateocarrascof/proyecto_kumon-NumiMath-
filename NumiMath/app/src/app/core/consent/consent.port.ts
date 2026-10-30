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

/**
 * Puerto del consentimiento del tutor. La implementación real usa las tablas con RLS de Supabase;
 * el plan B de la defensa usará una en memoria.
 */
export abstract class ConsentPort {
  /** Versiones vigentes con su texto. Lanza si la base o los textos no están disponibles. */
  abstract loadCurrent(): Promise<LegalBundle>;
  /** ¿El último evento del tutor es un "grant" de las versiones vigentes? */
  abstract hasActiveConsent(): Promise<boolean>;
  abstract accept(bundle: LegalBundle): Promise<ConsentResult>;
}
