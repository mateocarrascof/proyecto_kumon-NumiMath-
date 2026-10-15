import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthPort } from '../auth/auth.port';
import { SUPABASE_CLIENT } from '../auth/supabase.client';
import { LegalBundle } from './consent.port';
import { SupabaseConsentService, sha256Hex } from './supabase-consent.service';

const TEXTS: Record<string, string> = {
  'terminos.md': 'texto de términos\n',
  'privacidad.md': 'texto de privacidad\n',
  'declaracion-adulto.md': 'texto de declaración\n',
};

async function hash(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

interface Setup {
  inserted: unknown[];
  service: SupabaseConsentService;
}

async function setup(opts: {
  tamper?: boolean;
  lastConsent?: object | null;
  insertError?: { message: string } | null;
}): Promise<Setup> {
  const rows = [
    { id: 't1', kind: 'terms', version: 'tos-1', content_sha256: await hash(TEXTS['terminos.md']) },
    { id: 'p1', kind: 'privacy', version: 'pp-1', content_sha256: await hash(TEXTS['privacidad.md']) },
    {
      id: 'a1',
      kind: 'adult_declaration',
      version: 'ad-1',
      content_sha256: await hash(TEXTS['declaracion-adulto.md']),
    },
  ];
  const inserted: unknown[] = [];
  const client = {
    from: (table: string) => {
      if (table === 'legal_document_versions') {
        return { select: () => ({ eq: async () => ({ data: rows, error: null }) }) };
      }
      return {
        select: () => ({
          order: () => ({
            limit: async () => ({
              data: opts.lastConsent ? [opts.lastConsent] : [],
              error: null,
            }),
          }),
        }),
        insert: async (row: unknown) => {
          inserted.push(row);
          return { error: opts.insertError ?? null };
        },
      };
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const file = url.split('/').pop() as string;
      const body = opts.tamper ? 'texto alterado\n' : TEXTS[file];
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    }),
  );
  TestBed.configureTestingModule({
    providers: [
      { provide: SUPABASE_CLIENT, useValue: client },
      { provide: AuthPort, useValue: { user: signal({ id: 'tutor-1', email: 'a@b.test' }) } },
    ],
  });
  return { inserted, service: TestBed.inject(SupabaseConsentService) };
}

afterEach(() => vi.unstubAllGlobals());

describe('SupabaseConsentService', () => {
  it('carga las versiones vigentes y verifica la huella de cada texto', async () => {
    const { service } = await setup({});
    const bundle = await service.loadCurrent();
    expect(bundle.terms.verified).toBe(true);
    expect(bundle.privacy.version).toBe('pp-1');
    expect(bundle.adult_declaration.text).toContain('declaración');
  });

  it('marca como no verificado un texto que no coincide con su huella', async () => {
    const { service } = await setup({ tamper: true });
    const bundle = await service.loadCurrent();
    expect(bundle.terms.verified).toBe(false);
  });

  it('no deja aceptar un texto no verificado y no escribe nada', async () => {
    const { service, inserted } = await setup({ tamper: true });
    const bundle = await service.loadCurrent();
    expect(await service.accept(bundle)).toEqual({ ok: false, reason: 'unverified' });
    expect(inserted).toHaveLength(0);
  });

  it('acepta: inserta un grant del tutor con las versiones vigentes', async () => {
    const { service, inserted } = await setup({});
    const bundle: LegalBundle = await service.loadCurrent();
    expect(await service.accept(bundle)).toEqual({ ok: true });
    expect(inserted).toEqual([
      {
        tutor_id: 'tutor-1',
        event_type: 'grant',
        terms_version_id: 't1',
        privacy_version_id: 'p1',
        channel: 'web',
      },
    ]);
  });

  it('un grant redundante cuenta como éxito', async () => {
    const { service } = await setup({ insertError: { message: 'consent_event_redundant' } });
    expect(await service.accept(await service.loadCurrent())).toEqual({ ok: true });
  });

  it('hasActiveConsent: sin eventos es false', async () => {
    const { service } = await setup({ lastConsent: null });
    expect(await service.hasActiveConsent()).toBe(false);
  });

  it('hasActiveConsent: grant de las versiones vigentes es true', async () => {
    const { service } = await setup({
      lastConsent: { event_type: 'grant', terms_version_id: 't1', privacy_version_id: 'p1' },
    });
    expect(await service.hasActiveConsent()).toBe(true);
  });

  it('hasActiveConsent: un grant de una versión antigua es false (hay que re-aceptar)', async () => {
    const { service } = await setup({
      lastConsent: { event_type: 'grant', terms_version_id: 'viejo', privacy_version_id: 'p1' },
    });
    expect(await service.hasActiveConsent()).toBe(false);
  });

  it('hasActiveConsent: una revocación es false', async () => {
    const { service } = await setup({
      lastConsent: { event_type: 'revoke', terms_version_id: 't1', privacy_version_id: 'p1' },
    });
    expect(await service.hasActiveConsent()).toBe(false);
  });
});
