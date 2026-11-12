import { Signal } from '@angular/core';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthFailure =
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'same_password'
  | 'link_expired'
  | 'network'
  | 'unknown';

/** Datos del enlace del correo (`/nueva-clave?token_hash=…&type=recovery`). */
export interface RecoveryLink {
  tokenHash: string;
  type: string;
}

/** Resultado de abrir el enlace de recuperación: `ready` = ya se puede escribir la clave nueva. */
export type RecoveryStart = 'ready' | 'invalid';

export type AuthResult = { ok: true } | { ok: false; reason: AuthFailure };

/**
 * Puerto de autenticación del tutor (único con cuenta). Las pantallas solo conocen este contrato:
 * la implementación real usa Supabase Auth; el plan B de la defensa usará una en memoria.
 */
export abstract class AuthPort {
  abstract readonly user: Signal<AuthUser | null>;
  /** Se resuelve cuando ya se sabe si hay una sesión guardada. */
  abstract ready(): Promise<void>;
  abstract signUp(email: string, password: string): Promise<AuthResult>;
  abstract signIn(email: string, password: string): Promise<AuthResult>;
  abstract signOut(): Promise<void>;
  /**
   * Pide el enlace para crear una contraseña nueva. NUNCA lanza ni dice si el correo existe: la
   * respuesta es la misma haya o no cuenta (y ante cualquier error), para no revelar cuentas.
   */
  abstract requestPasswordReset(email: string): Promise<void>;
  /**
   * Canjea el código del enlace del correo (se llama al PULSAR un botón, nunca al abrir la página:
   * así un escáner de correo que solo abre el enlace no lo gasta). Sirve una sola vez.
   */
  abstract beginRecovery(link: RecoveryLink): Promise<RecoveryStart>;
  /** Fija la contraseña nueva y cierra la sesión en TODOS los dispositivos. */
  abstract completePasswordReset(newPassword: string): Promise<AuthResult>;
  /**
   * Abandona una recuperación a medias: cierra su sesión. La sesión de recuperación no cuenta como
   * usuario autenticado (no abre el panel ni los perfiles) hasta que se cambie la contraseña.
   */
  abstract cancelRecovery(): Promise<void>;
  /** JWT vigente para llamar a la API (FastAPI). `null` si no hay sesión. */
  abstract accessToken(): Promise<string | null>;
}
