import { Signal } from '@angular/core';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthFailure =
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'network'
  | 'unknown';

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
}
