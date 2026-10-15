import { Injectable, inject, signal } from '@angular/core';
import { AuthError, Session } from '@supabase/supabase-js';

import { AuthFailure, AuthPort, AuthResult, AuthUser } from './auth.port';
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
    default:
      return error.status === 0 || error.name === 'AuthRetryableFetchError' ? 'network' : 'unknown';
  }
}

@Injectable({ providedIn: 'root' })
export class SupabaseAuthService extends AuthPort {
  private readonly client = inject(SUPABASE_CLIENT);
  private readonly current = signal<AuthUser | null>(null);
  private readonly initialized: Promise<void>;

  readonly user = this.current.asReadonly();

  constructor() {
    super();
    this.initialized = this.client.auth.getSession().then(
      ({ data }) => {
        this.current.set(toUser(data.session));
      },
      () => {
        this.current.set(null);
      },
    );
    this.client.auth.onAuthStateChange((_event, session) => {
      this.current.set(toUser(session));
    });
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
      this.current.set(null);
    }
  }
}
