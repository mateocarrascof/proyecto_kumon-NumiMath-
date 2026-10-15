import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthPort } from '../auth/auth.port';
import { SUPABASE_CLIENT } from '../auth/supabase.client';
import { SupabaseProfilesService } from './supabase-profiles.service';

function setup(result: { data?: unknown; error?: { message: string } | null }) {
  const inserted: unknown[] = [];
  const deleted: string[] = [];
  const client = {
    from: () => ({
      select: () => ({
        order: async () => ({ data: result.data ?? [], error: result.error ?? null }),
      }),
      insert: (row: unknown) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({ data: result.data ?? null, error: result.error ?? null }),
          }),
        };
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          deleted.push(id);
          return { error: result.error ?? null };
        },
      }),
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: SUPABASE_CLIENT, useValue: client },
      { provide: AuthPort, useValue: { user: signal({ id: 'tutor-1', email: 'a@b.test' }) } },
    ],
  });
  return { service: TestBed.inject(SupabaseProfilesService), inserted, deleted };
}

describe('SupabaseProfilesService', () => {
  it('lista perfiles y marca los bloqueados', async () => {
    const { service } = setup({
      data: [
        { id: 'a', nickname: 'Pia', grade: 2, blocked_at: null },
        { id: 'b', nickname: 'Pol', grade: 3, blocked_at: '2026-10-01T00:00:00Z' },
      ],
    });
    const list = await service.list();
    expect(list.map((p) => [p.nickname, p.grade, p.blocked])).toEqual([
      ['Pia', 2, false],
      ['Pol', 3, true],
    ]);
  });

  it('crea con solo apodo, curso y la declaración del adulto', async () => {
    const { service, inserted } = setup({
      data: { id: 'n', nickname: 'Luz', grade: 1, blocked_at: null },
    });
    const result = await service.create('  Luz ', 1);
    expect(result.ok).toBe(true);
    expect(inserted).toEqual([
      { tutor_id: 'tutor-1', nickname: 'Luz', grade: 1, adult_declaration_accepted: true },
    ]);
  });

  it('rechaza un apodo vacío o demasiado largo sin tocar la base', async () => {
    const { service, inserted } = setup({});
    expect(await service.create('   ', 1)).toEqual({ ok: false, reason: 'nickname' });
    expect(await service.create('x'.repeat(31), 1)).toEqual({ ok: false, reason: 'nickname' });
    expect(inserted).toHaveLength(0);
  });

  it('traduce los errores de la base a motivos cerrados', async () => {
    const limit = setup({ error: { message: 'student_limit_reached' } });
    expect(await limit.service.create('Luz', 1)).toEqual({ ok: false, reason: 'limit' });
    TestBed.resetTestingModule();
    const consent = setup({ error: { message: 'consent_required' } });
    expect(await consent.service.create('Luz', 1)).toEqual({ ok: false, reason: 'consent' });
  });

  it('borra por id', async () => {
    const { service, deleted } = setup({});
    expect(await service.remove('abc')).toBe(true);
    expect(deleted).toEqual(['abc']);
  });
});
