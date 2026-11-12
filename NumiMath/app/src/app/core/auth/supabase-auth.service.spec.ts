import { TestBed } from '@angular/core/testing';

import { SESSION_TIMEOUT_MS, SupabaseAuthService } from './supabase-auth.service';
import { SUPABASE_CLIENT } from './supabase.client';

type Resp = { data: unknown; error: unknown };

function fakeClient(over: {
  signUp?: Resp;
  signIn?: Resp;
  session?: unknown;
  throws?: boolean;
}) {
  const boom = () => {
    if (over.throws) throw new Error('red caída');
  };
  return {
    auth: {
      getSession: async () => ({ data: { session: over.session ?? null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signUp: async () => {
        boom();
        return over.signUp ?? { data: {}, error: null };
      },
      signInWithPassword: async () => {
        boom();
        return over.signIn ?? { data: {}, error: null };
      },
      signOut: async () => ({ error: null }),
    },
  };
}

function service(over: Parameters<typeof fakeClient>[0]): SupabaseAuthService {
  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE_CLIENT, useValue: fakeClient(over) }],
  });
  return TestBed.inject(SupabaseAuthService);
}

describe('SupabaseAuthService', () => {
  it('si Supabase no responde al abrir, sigue sin sesión en vez de quedarse en blanco', async () => {
    vi.useFakeTimers();
    try {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: SUPABASE_CLIENT,
            useValue: {
              auth: {
                // El refresco del token nunca responde (servidor apagado).
                getSession: () => new Promise(() => undefined),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
              },
            },
          },
        ],
      });
      const s = TestBed.inject(SupabaseAuthService);
      let done = false;
      void s.ready().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect(s.user()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin sesión guardada el usuario es null', async () => {
    const s = service({});
    await s.ready();
    expect(s.user()).toBeNull();
  });

  it('con sesión guardada expone id y correo', async () => {
    const s = service({ session: { user: { id: 'u1', email: 'a@b.test' } } });
    await s.ready();
    expect(s.user()).toEqual({ id: 'u1', email: 'a@b.test', role: 'tutor' });
  });

  it('el rol sale de app_metadata; user_metadata y valores raros no dan rol', async () => {
    const roleFor = async (user: Record<string, unknown>) => {
      TestBed.resetTestingModule();
      const s = service({ session: { user: { id: 'u1', email: 'a@b.test', ...user } } });
      await s.ready();
      return s.user()?.role;
    };
    expect(await roleFor({ app_metadata: { role: 'teacher' } })).toBe('teacher');
    expect(await roleFor({ app_metadata: { role: 'admin' } })).toBe('admin');
    expect(await roleFor({ user_metadata: { role: 'admin' } })).toBe('tutor');
    expect(await roleFor({ app_metadata: { role: 'root' } })).toBe('tutor');
  });

  it('entrega el token de acceso para llamar a la API, o null sin sesión', async () => {
    const con = service({ session: { access_token: 'jwt-1', user: { id: 'u1', email: 'a@b.test' } } });
    expect(await con.accessToken()).toBe('jwt-1');
    TestBed.resetTestingModule();
    expect(await service({}).accessToken()).toBeNull();
  });

  it('inicio de sesión correcto', async () => {
    expect(await service({}).signIn('a@b.test', 'clave-larga-1')).toEqual({ ok: true });
  });

  it('credenciales inválidas se traducen a un motivo cerrado', async () => {
    const s = service({ signIn: { data: {}, error: { code: 'invalid_credentials', status: 400 } } });
    expect(await s.signIn('a@b.test', 'mala')).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('registro con correo existente (sin identidades) = email_taken', async () => {
    const s = service({ signUp: { data: { user: { identities: [] }, session: null }, error: null } });
    expect(await s.signUp('a@b.test', 'clave-larga-1')).toEqual({ ok: false, reason: 'email_taken' });
  });

  it('registro correcto con sesión', async () => {
    const s = service({
      signUp: { data: { user: { identities: [{}] }, session: { user: {} } }, error: null },
    });
    expect(await s.signUp('a@b.test', 'clave-larga-1')).toEqual({ ok: true });
  });

  it('un fallo de red no lanza: devuelve network', async () => {
    const s = service({ throws: true });
    expect(await s.signIn('a@b.test', 'clave-larga-1')).toEqual({ ok: false, reason: 'network' });
    expect(await s.signUp('a@b.test', 'clave-larga-1')).toEqual({ ok: false, reason: 'network' });
  });
});
