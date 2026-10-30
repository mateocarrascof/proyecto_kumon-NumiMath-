import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { ParentalSession } from '../parental/parental-session';

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
      {
        provide: AuthPort,
        useValue: {
          user: signal({ id: 'tutor-1', email: 'a@b.test' }),
          accessToken: async () => 'jwt',
        },
      },
      provideHttpClient(),
      provideHttpClientTesting(),
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

  it('borrar NO toca la base directo: va a la API con el token del PIN', async () => {
    const { service, deleted } = setup({});
    TestBed.inject(ParentalSession).start('token-del-pin', 600);
    const http = TestBed.inject(HttpTestingController);
    const result = service.remove('abc');
    await new Promise((r) => setTimeout(r, 0));
    const req = http.expectOne(`${environment.apiUrl}/v1/students/abc`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBe('ok');
    expect(deleted).toEqual([]);
  });

  it('sin PIN vigente devuelve "pin"; ya borrado, "not_found"', async () => {
    const { service } = setup({});
    const http = TestBed.inject(HttpTestingController);
    const url = `${environment.apiUrl}/v1/students/abc`;
    const cases: [number, object, string][] = [
      [401, { error: { code: 'parental_required' } }, 'pin'],
      [404, { error: { code: 'not_found' } }, 'not_found'],
      [503, {}, 'error'],
    ];
    for (const [status, body, expected] of cases) {
      const result = service.remove('abc');
      await new Promise((r) => setTimeout(r, 0));
      http.expectOne(url).flush(body, { status, statusText: 'x' });
      expect(await result).toBe(expected);
    }
  });
});
