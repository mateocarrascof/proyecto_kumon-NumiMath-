import { Injectable, inject } from '@angular/core';

import { AuthPort } from '../auth/auth.port';
import { SUPABASE_CLIENT } from '../auth/supabase.client';
import { ConsentPort, ConsentResult, ConsentStatus, LegalBundle, LegalDocument, LegalKind } from './consent.port';

/** Archivo servido por la app para cada tipo de documento (fuente: docs/legal-provisional). */
export const LEGAL_FILES: Record<LegalKind, string> = {
  terms: 'terminos.md',
  privacy: 'privacidad.md',
  adult_declaration: 'declaracion-adulto.md',
};

interface VersionRow {
  id: string;
  kind: LegalKind;
  version: string;
  content_sha256: string;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class SupabaseConsentService extends ConsentPort {
  private readonly client = inject(SUPABASE_CLIENT);
  private readonly auth = inject(AuthPort);

  private async currentVersions(): Promise<VersionRow[]> {
    const { data, error } = await this.client
      .from('legal_document_versions')
      .select('id, kind, version, content_sha256')
      .eq('is_current', true);
    if (error || !data) throw new Error('versions_unavailable');
    // Solo los textos del consentimiento: otros textos vigentes (como la autorización del docente)
    // tienen su propia pantalla y no forman parte de lo que se acepta al crear la cuenta.
    return (data as VersionRow[]).filter((row) => Object.prototype.hasOwnProperty.call(LEGAL_FILES, row.kind));
  }

  async loadCurrent(): Promise<LegalBundle> {
    const rows = await this.currentVersions();
    const docs = await Promise.all(
      rows.map(async (row): Promise<LegalDocument> => {
        const response = await fetch(`/assets/legal/${LEGAL_FILES[row.kind]}`);
        if (!response.ok) throw new Error('text_unavailable');
        const bytes = await response.arrayBuffer();
        const verified = (await sha256Hex(bytes)) === row.content_sha256;
        const text = new TextDecoder('utf-8').decode(bytes);
        return { id: row.id, kind: row.kind, version: row.version, text, verified };
      }),
    );
    const byKind = new Map(docs.map((d) => [d.kind, d]));
    const terms = byKind.get('terms');
    const privacy = byKind.get('privacy');
    const adult = byKind.get('adult_declaration');
    if (!terms || !privacy || !adult) throw new Error('versions_incomplete');
    return { terms, privacy, adult_declaration: adult };
  }

  async consentStatus(): Promise<ConsentStatus> {
    try {
      const [rows, latest] = await Promise.all([
        this.currentVersions(),
        this.client
          .from('consents')
          .select('event_type, terms_version_id, privacy_version_id')
          .order('seq', { ascending: false })
          .limit(1),
      ]);
      const last = latest.data?.[0] as
        | { event_type: string; terms_version_id: string; privacy_version_id: string }
        | undefined;
      // Error de la consulta: no se sabe (puede ser falta de red). El guard falla cerrado igual.
      if (latest.error) return 'unknown';
      const terms = rows.find((r) => r.kind === 'terms');
      const privacy = rows.find((r) => r.kind === 'privacy');
      // Sin versiones vigentes la base no respondió lo esperado: no se sabe, y no se borra nada.
      if (!terms || !privacy) return 'unknown';
      if (!last) return 'missing';
      const active =
        last.event_type === 'grant' &&
        last.terms_version_id === terms?.id &&
        last.privacy_version_id === privacy?.id;
      return active ? 'active' : 'missing';
    } catch {
      // No se pudo consultar: el guard no deja pasar (falla cerrado), pero no borra nada.
      return 'unknown';
    }
  }

  async accept(bundle: LegalBundle): Promise<ConsentResult> {
    const user = this.auth.user();
    if (!user) return { ok: false, reason: 'unknown' };
    if (!bundle.terms.verified || !bundle.privacy.verified) {
      return { ok: false, reason: 'unverified' };
    }
    try {
      const { error } = await this.client.from('consents').insert({
        tutor_id: user.id,
        event_type: 'grant',
        terms_version_id: bundle.terms.id,
        privacy_version_id: bundle.privacy.id,
        channel: 'web',
      });
      if (!error) return { ok: true };
      // Un "grant" repetido sobre las mismas versiones ya está registrado: es un éxito.
      return error.message.includes('consent_event_redundant')
        ? { ok: true }
        : { ok: false, reason: 'unknown' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }
}
