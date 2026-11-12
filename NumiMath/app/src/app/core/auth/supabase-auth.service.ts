import { Injectable, inject, signal } from '@angular/core';
import { AuthError, Session } from '@supabase/supabase-js';

import {
  AuthFailure,
  AuthPort,
  AuthResult,
  AuthUser,
  RecoveryLink,
  RecoveryStart,
} from './auth.port';
import { OfflineStore } from '../offline/offline-store.port';
import { passwordProblem } from './password-rules';
import { SUPABASE_CLIENT } from './supabase.client';

function toUser(session: Session | null): AuthUser | null {
  const u = session?.user;
  return u ? { id: u.id, email: u.email ?? '' } : null;
}

/** Traduce el error del proveedor a un motivo cerrado; nunca se muestra el mensaje crudo. */
function reasonOf(error: AuthError): AuthFailure {
  switch (error.code) {
    case 'invalid_credentials':
      return 'invalid_credentials';
    case 'user_already_exists':
    case 'email_exists':
      return 'email_taken';
    case 'weak_password':
      return 'weak_password';
    case 'same_password':
      return 'same_password';
    case 'otp_expired':
    case 'session_not_found':
    case 'session_expired':
    case 'not_authenticated':
    case 'bad_jwt':
      return 'link_expired';
    default:
      return error.status === 0 || error.name === 'AuthRetryableFetchError' ? 'network' : 'unknown';
  }
}

/** Espera máxima para saber si hay sesión guardada al abrir la app. */
export const SESSION_TIMEOUT_MS = 8000;

/**
 * Marca (en esta pestaña) de que hay una sesión de RECUPERACIÓN a medias. Sirve para cerrarla si
 * la persona recarga o se va sin cambiar la contraseña: esa sesión no debe valer como un inicio
 * de sesión normal (daría acceso a los perfiles de los niños sin conocer la contraseña).
 */
export const RECOVERY_FLAG = 'numi-recovery-pending';

function recoveryFlag(value?: boolean): boolean {
  try {
    if (value === undefined) return window.sessionStorage.getItem(RECOVERY_FLAG) === '1';
    if (value) window.sessionStorage.setItem(RECOVERY_FLAG, '1');
    else window.sessionStorage.removeItem(RECOVERY_FLAG);
  } catch {
    // sin almacenamiento disponible: la sesión de recuperación igual no se expone (ver `recovering`)
  }
  return value ?? false;
}

@Injectable({ providedIn: 'root' })
export class SupabaseAuthService extends AuthPort {
  private readonly client = inject(SUPABASE_CLIENT);
  private readonly offlineStore = inject(OfflineStore);
  private readonly current = signal<AuthUser | null>(null);
  private readonly initialized: Promise<void>;
  /** Mientras es true, la sesión de recuperación NO se expone como usuario autenticado. */
  private recovering = false;

  readonly user = this.current.asReadonly();

  constructor() {
    super();
    // Una recuperación a medias de una carga anterior (recarga, pestaña cerrada) se descarta.
    const leftover = recoveryFlag();
    // Si Supabase no responde (p. ej. el servidor local está apagado), getSession puede quedarse
    // esperando el refresco del token para siempre y la app no mostraría nada. Tras el límite se
    // sigue sin sesión (pantalla de login); si la sesión llega después, onAuthStateChange la aplica.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SESSION_TIMEOUT_MS);
    });
    this.initialized = Promise.race([
      this.client.auth.getSession().then(({ data }) => data.session),
      timeout,
    ]).then(
      async (session) => {
        clearTimeout(timer);
        if (leftover) {
          recoveryFlag(false);
          await this.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
          this.current.set(null);
          return;
        }
        this.current.set(toUser(session));
      },
      () => {
        clearTimeout(timer);
        this.current.set(null);
      },
    );
    this.client.auth.onAuthStateChange((event, session) => {
      if (this.recovering) return;
      const user = toUser(session);
      this.current.set(user);
      void this.guardOfflineData(event, user);
    });
  }

  /**
   * CU-A12: lo guardado para practicar sin conexión pertenece a UN tutor. Se borra si la sesión
   * terminó sin pasar por "Cerrar sesión" (sesión revocada, cambio de contraseña en otro equipo:
   * Supabase avisa `SIGNED_OUT`) o si entra otro tutor en el mismo equipo. Una falla de red NO
   * dispara `SIGNED_OUT` (Supabase reintenta), así que no se pierde nada por estar sin internet.
   */
  private async guardOfflineData(event: string, user: AuthUser | null): Promise<void> {
    try {
      if (event === 'SIGNED_OUT') {
        await this.offlineStore.clear();
        return;
      }
      if (!user) return;
      const owner = await this.offlineStore.owner();
      if (owner && owner.tutorId !== user.id) await this.offlineStore.clear();
    } catch {
      // Mejor esfuerzo: si el almacén falla, igual vence a los 7 días.
    }
  }

  ready(): Promise<void> {
    return this.initialized;
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    try {
      const { data, error } = await this.client.auth.signUp({ email, password });
      if (error) return { ok: false, reason: reasonOf(error) };
      // Con correo ya registrado, Supabase puede responder sin error y sin identidades.
      if (data.user && (data.user.identities?.length ?? 1) === 0) {
        return { ok: false, reason: 'email_taken' };
      }
      return data.session ? { ok: true } : { ok: false, reason: 'unknown' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    try {
      const { error } = await this.client.auth.signInWithPassword({ email, password });
      return error ? { ok: false, reason: reasonOf(error) } : { ok: true };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    try {
      // El resultado se descarta a propósito: ni el error ni la respuesta pueden delatar si el
      // correo tiene cuenta.
      // El enlace del correo lo arma la plantilla con el SiteURL de Supabase (config.toml).
      // shortcut: solo web; en la app nativa (Capacitor) habrá que usar un deep link propio.
      await this.client.auth.resetPasswordForEmail(email);
    } catch {
      // igual que si hubiera salido bien
    }
  }

  async beginRecovery(link: RecoveryLink): Promise<RecoveryStart> {
    if (link.type !== 'recovery' || !/^[\w-]{8,200}$/.test(link.tokenHash)) return 'invalid';
    // Desde aquí hay una sesión de recuperación: no cuenta como usuario hasta cambiar la contraseña.
    this.recovering = true;
    recoveryFlag(true);
    try {
      const { error } = await this.client.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: 'recovery',
      });
      if (!error) return 'ready';
    } catch {
      // cae al caso inválido
    }
    this.recovering = false;
    recoveryFlag(false);
    return 'invalid';
  }

  async cancelRecovery(): Promise<void> {
    if (!this.recovering) return;
    this.recovering = false;
    recoveryFlag(false);
    await this.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    this.current.set(null);
  }

  async completePasswordReset(newPassword: string): Promise<AuthResult> {
    if (passwordProblem(newPassword)) return { ok: false, reason: 'weak_password' };
    try {
      const { error } = await this.client.auth.updateUser({ password: newPassword });
      // Si falla, la sesión de recuperación sigue pendiente: la persona puede reintentar.
      if (error) return { ok: false, reason: reasonOf(error) };
    } catch {
      return { ok: false, reason: 'network' };
    }
    // Cambiar la contraseña cierra las demás sesiones: quien la tuviera robada pierde el acceso.
    await this.client.auth.signOut({ scope: 'global' }).catch(() => undefined);
    this.recovering = false;
    recoveryFlag(false);
    this.current.set(null);
    return { ok: true };
  }

  async accessToken(): Promise<string | null> {
    try {
      // getSession renueva el token si está por vencer.
      const { data } = await this.client.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.client.auth.signOut();
    } finally {
      // CU-A12: al cerrar sesión se borra todo lo guardado para practicar sin conexión.
      await this.offlineStore.clear().catch(() => undefined);
      this.current.set(null);
    }
  }
}
