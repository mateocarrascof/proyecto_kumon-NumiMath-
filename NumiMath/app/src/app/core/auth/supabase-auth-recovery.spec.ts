import { TestBed } from '@angular/core/testing';

import { RecoveryLink } from './auth.port';
import { SupabaseAuthService } from './supabase-auth.service';
import { SUPABASE_CLIENT } from './supabase.client';

interface Calls {
  reset: unknown[][];
  verifyOtp: unknown[];
  updateUser: unknown[];
  signOut: unknown[];
}

type Listener = (event: string, session: unknown) => void;

function setup(
  over: {
    resetThrows?: boolean;
    resetError?: boolean;
    verifyError?: boolean;
    updateError?: { code?: string; status?: number };
    signOutThrows?: boolean;
    storedSession?: unknown;
  } = {},
) {
  const calls: Calls = { reset: [], verifyOtp: [], updateUser: [], signOut: [] };
  const listeners: Listener[] = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: over.storedSession ?? null } }),
      onAuthStateChange: (cb: Listener) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      resetPasswordForEmail: async (...args: unknown[]) => {
        calls.reset.push(args);
        if (over.resetThrows) throw new Error('red caída');
        return over.resetError
          ? { data: null, error: { status: 429, code: 'over_email_send_rate_limit' } }
          : { data: {}, error: null };
      },
      verifyOtp: async (arg: unknown) => {
        calls.verifyOtp.push(arg);
        return over.verifyError
          ? { data: {}, error: { status: 403, code: 'otp_expired' } }
          : { data: {}, error: null };
      },
      updateUser: async (arg: unknown) => {
        calls.updateUser.push(arg);
        return over.updateError ? { data: {}, error: over.updateError } : { data: {}, error: null };
      },
      signOut: async (arg?: unknown) => {
        calls.signOut.push(arg);
        if (over.signOutThrows) throw new Error('x');
        return { error: null };
      },
    },
  };
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE_CLIENT, useValue: client }] });
  const emit = (event: string, session: unknown) => listeners.forEach((l) => l(event, session));
  return { service: TestBed.inject(SupabaseAuthService), calls, emit };
}

const SESSION = { user: { id: 'u1', email: 'ana@example.test' } };
const LINK: RecoveryLink = { tokenHash: 'abcdefgh12345678', type: 'recovery' };

describe('SupabaseAuthService: la sesión de recuperación no es un inicio de sesión', () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => window.sessionStorage.clear());

  it('mientras se recupera, el usuario sigue siendo null (no abre el panel ni los perfiles)', async () => {
    const { service, emit } = setup();
    await service.ready();
    expect(await service.beginRecovery(LINK)).toBe('ready');
    emit('SIGNED_IN', SESSION); // Supabase anuncia la sesión creada por el enlace
    expect(service.user()).toBeNull();
  });

  it('al cambiar la contraseña termina la recuperación y los inicios de sesión normales vuelven a valer', async () => {
    const { service, emit } = setup();
    await service.beginRecovery(LINK);
    expect(await service.completePasswordReset('Clave-nueva-456')).toEqual({ ok: true });
    emit('SIGNED_IN', SESSION);
    expect(service.user()).toEqual({ id: 'u1', email: 'ana@example.test', role: 'tutor' });
    expect(window.sessionStorage.getItem('numi-recovery-pending')).toBeNull();
  });

  it('abandonar la recuperación cierra la sesión (solo en este dispositivo)', async () => {
    const { service, calls } = setup();
    await service.beginRecovery(LINK);
    await service.cancelRecovery();
    expect(calls.signOut).toEqual([{ scope: 'local' }]);
    expect(service.user()).toBeNull();
    expect(window.sessionStorage.getItem('numi-recovery-pending')).toBeNull();
  });

  it('cancelar sin recuperación en curso no hace nada', async () => {
    const { service, calls } = setup();
    await service.cancelRecovery();
    expect(calls.signOut).toEqual([]);
  });

  it('si la persona recarga a mitad de la recuperación, esa sesión se descarta al abrir la app', async () => {
    window.sessionStorage.setItem('numi-recovery-pending', '1');
    const { service, calls } = setup({ storedSession: SESSION });
    await service.ready();
    expect(service.user()).toBeNull();
    expect(calls.signOut).toEqual([{ scope: 'local' }]);
    expect(window.sessionStorage.getItem('numi-recovery-pending')).toBeNull();
  });

  it('sin marca de recuperación, una sesión guardada normal se conserva', async () => {
    const { service } = setup({ storedSession: SESSION });
    await service.ready();
    expect(service.user()).toEqual({ id: 'u1', email: 'ana@example.test', role: 'tutor' });
  });

  it('un enlace inválido no deja la recuperación activa', async () => {
    const { service, emit } = setup({ verifyError: true });
    expect(await service.beginRecovery(LINK)).toBe('invalid');
    emit('SIGNED_IN', SESSION);
    expect(service.user()).not.toBeNull();
  });

  it('si el servidor rechaza la contraseña nueva, la recuperación sigue pendiente para reintentar', async () => {
    const { service, emit } = setup({ updateError: { code: 'weak_password', status: 422 } });
    await service.beginRecovery(LINK);
    await service.completePasswordReset('Clave-nueva-456');
    emit('SIGNED_IN', SESSION);
    expect(service.user()).toBeNull();
  });

  it('un fallo al guardar no cambia el usuario que ya había', async () => {
    const { service } = setup({
      storedSession: SESSION,
      updateError: { code: 'weak_password', status: 422 },
    });
    await service.ready();
    await service.completePasswordReset('Clave-nueva-456');
    expect(service.user()).toEqual({ id: 'u1', email: 'ana@example.test', role: 'tutor' });
  });
});

describe('SupabaseAuthService: recuperar contraseña', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('pide el enlace sin redirect propio: el correo lo arma la plantilla con el SiteURL', async () => {
    const { service, calls } = setup();
    await service.requestPasswordReset('ana@example.test');
    expect(calls.reset).toEqual([['ana@example.test']]);
  });

  it('resuelve igual con éxito, con error del servidor (p. ej. 429) y con una excepción', async () => {
    for (const over of [{}, { resetError: true }, { resetThrows: true }]) {
      TestBed.resetTestingModule();
      const { service } = setup(over);
      await expect(service.requestPasswordReset('ana@example.test')).resolves.toBeUndefined();
    }
  });

  it('canjea el código del enlace una vez y abre la sesión de recuperación', async () => {
    const { service, calls } = setup();
    expect(await service.beginRecovery(LINK)).toBe('ready');
    expect(calls.verifyOtp).toEqual([{ token_hash: 'abcdefgh12345678', type: 'recovery' }]);
  });

  it('un enlace vencido o ya usado (el servidor lo rechaza) es inválido', async () => {
    const { service } = setup({ verifyError: true });
    expect(await service.beginRecovery(LINK)).toBe('invalid');
  });

  it('un código mal formado o de otro tipo ni siquiera llega al servidor', async () => {
    const { service, calls } = setup();
    for (const link of [
      { tokenHash: '', type: 'recovery' },
      { tokenHash: 'corto', type: 'recovery' },
      { tokenHash: 'abcdefgh12345678', type: 'signup' },
      { tokenHash: 'abcdefgh1234 5678;drop', type: 'recovery' },
      { tokenHash: 'a'.repeat(300), type: 'recovery' },
    ]) {
      expect(await service.beginRecovery(link)).toBe('invalid');
    }
    expect(calls.verifyOtp).toEqual([]);
  });

  it('cambia la contraseña y cierra TODAS las sesiones', async () => {
    const { service, calls } = setup();
    expect(await service.completePasswordReset('Clave-nueva-456')).toEqual({ ok: true });
    expect(calls.updateUser).toEqual([{ password: 'Clave-nueva-456' }]);
    expect(calls.signOut).toEqual([{ scope: 'global' }]);
    expect(service.user()).toBeNull();
  });

  it('aplica la regla actual: una contraseña corta ni siquiera llega al servidor', async () => {
    const { service, calls } = setup();
    expect(await service.completePasswordReset('corta')).toEqual({
      ok: false,
      reason: 'weak_password',
    });
    expect(calls.updateUser).toEqual([]);
  });

  it('traduce los errores del servidor a motivos cerrados y no cierra sesiones', async () => {
    for (const [error, reason] of [
      [{ code: 'weak_password', status: 422 }, 'weak_password'],
      [{ code: 'same_password', status: 422 }, 'same_password'],
      [{ code: 'session_not_found', status: 403 }, 'link_expired'],
      [{ status: 500 }, 'unknown'],
    ] as const) {
      TestBed.resetTestingModule();
      const { service, calls } = setup({ updateError: error });
      expect(await service.completePasswordReset('Clave-nueva-456')).toEqual({ ok: false, reason });
      expect(calls.signOut).toEqual([]);
    }
  });

  it('si no se puede cerrar la sesión global, igual informa que la contraseña cambió', async () => {
    const { service } = setup({ signOutThrows: true });
    expect(await service.completePasswordReset('Clave-nueva-456')).toEqual({ ok: true });
  });
});
