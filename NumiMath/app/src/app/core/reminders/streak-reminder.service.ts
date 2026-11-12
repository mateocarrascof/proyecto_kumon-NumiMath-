import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { PROFILES_TTL_SECONDS } from '../offline/offline.model';
import { OfflineStore } from '../offline/offline-store.port';
import { ParentalSession } from '../parental/parental-session';
import { ReminderNotifier } from './reminder-notifier.port';
import { STREAK_REMINDER_NOTIFICATION } from './streak-reminder.messages';

/** Hora fija del aviso (decisión del dueño). Elegirla queda como pendiente. */
export const REMINDER_HOUR = 18;

/** 18:00 de hoy si aún no pasa y no hay que saltarse hoy; si no, 18:00 de mañana (hora local). */
export function nextReminderAt(now: Date, skipToday: boolean): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), REMINDER_HOUR);
  if (!skipToday && now < today) return today;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, REMINDER_HOUR);
}

/** `pin`: el token del PIN venció. `denied`: el sistema no permite avisos. */
export type ReminderChange = 'ok' | 'pin' | 'denied' | 'unsupported' | 'error';

/**
 * CU-A9: recordatorio de racha LOCAL (ADR 0003).
 *
 * - Se programa SOLO el próximo aviso (uno por dispositivo, a las 18:00), nunca una serie: si la
 *   copia local vence o la app no se abre, no quedan avisos huérfanos repitiéndose.
 * - Se reprograma al abrir la app, al volver a primer plano, al cargar los perfiles, tras practicar
 *   y cada vez que cambia lo guardado sin conexión (cerrar sesión, revocar, otro tutor, borrar o
 *   pausar un perfil, purga): si ya no hay perfiles con el recordatorio activo, se cancela.
 * - Si se sabe que TODOS los perfiles con recordatorio ya practicaron hoy, el aviso pasa a mañana.
 * - Nada sale del dispositivo: el servidor solo guarda el sí o no de cada perfil.
 */
@Injectable({ providedIn: 'root' })
export class StreakReminderService {
  private readonly store = inject(OfflineStore);
  private readonly notifier = inject(ReminderNotifier);
  // Sesión, HTTP y PIN solo se usan desde el panel (setEnabled): se piden recién ahí, para que
  // la práctica y "¿Quién practica?" no dependan de ellos.
  private readonly injector = inject(Injector);
  private chain: Promise<void> = Promise.resolve();
  private started = false;
  private readonly practiced = new Set<string>();

  /** Reloj (las pruebas lo cambian). */
  now: () => Date = () => new Date();

  supported(): boolean {
    return this.notifier.supported();
  }

  /** Una sola vez al iniciar la app: escucha cambios de la copia local y el toque del aviso. */
  start(openProfiles: () => void): void {
    if (this.started) return;
    this.started = true;
    this.store.onChange(() => void this.reschedule());
    if (this.notifier.supported()) this.notifier.onTap(openProfiles);
    void this.reschedule();
  }

  /**
   * Recalcula el único aviso. `practicedToday`: perfiles que se sabe que ya practicaron hoy (por
   * ejemplo, leídos del servidor). Sin esa información se respeta el aviso ya programado.
   * Las llamadas van en fila: dos a la vez no programan dos avisos.
   */
  reschedule(practicedToday?: ReadonlySet<string>): Promise<void> {
    const run = () => this.run(practicedToday).catch(() => undefined);
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  /** Tras una respuesta (con o sin red): ese perfil ya practicó hoy. */
  notePractice(studentId: string): Promise<void> {
    const day = this.today();
    const key = `${day}|${studentId}`;
    if (this.practiced.has(key)) return Promise.resolve();
    this.practiced.add(key);
    return this.reschedule(this.practicedOn(day));
  }

  /**
   * Activa o desactiva el recordatorio de un perfil (solo panel del tutor, con PIN vigente). Al
   * activarlo pide antes el permiso del sistema; si el adulto lo niega, no se guarda nada.
   */
  async setEnabled(studentId: string, enabled: boolean): Promise<ReminderChange> {
    if (enabled) {
      if (!this.notifier.supported()) return 'unsupported';
      const granted = await this.notifier.requestPermission().catch(() => false);
      if (!granted) return 'denied';
    }
    const http = this.injector.get(HttpClient);
    const parental = this.injector.get(ParentalSession);
    const token = await this.injector.get(AuthPort).accessToken();
    if (!token) return 'error';
    try {
      await firstValueFrom(
        http.put(
          `${environment.apiUrl}/v1/students/${encodeURIComponent(studentId)}/streak-reminder`,
          { enabled },
          { headers: { Authorization: `Bearer ${token}`, ...parental.header() } },
        ),
      );
    } catch (error) {
      // 401/403 con el PIN ya vencido: hay que volver a escribirlo. Lo demás, reintentar.
      const denied =
        error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
      return denied && !parental.isUnlocked() ? 'pin' : 'error';
    }
    await this.updateLocalCopy(studentId, enabled);
    await this.reschedule();
    return 'ok';
  }

  private async run(practicedToday?: ReadonlySet<string>): Promise<void> {
    if (!this.notifier.supported()) return;
    const now = this.now();
    const nowS = Math.floor(now.getTime() / 1000);
    const [owner, profiles] = await Promise.all([
      this.store.owner().catch(() => null),
      this.store.profiles().catch(() => []),
    ]);
    // Copia vencida o sin dueño: como si no hubiera perfiles (no quedan avisos huérfanos).
    const valid = owner !== null && owner.savedAt + PROFILES_TTL_SECONDS > nowS;
    const enabled = valid ? profiles.filter((p) => p.streakReminder === true && !p.blocked) : [];
    if (enabled.length === 0) {
      await this.notifier.cancel();
      return;
    }
    const known = practicedToday ?? this.practicedOn(this.today());
    const allPracticed = enabled.every((p) => known.has(p.id));
    if (!practicedToday && !allPracticed) {
      // Sin información nueva: si ya hay un aviso futuro, se deja como está.
      const pending = await this.notifier.pending().catch(() => null);
      if (pending && pending > now) return;
    }
    await this.notifier.schedule(
      nextReminderAt(now, allPracticed),
      STREAK_REMINDER_NOTIFICATION.title,
      STREAK_REMINDER_NOTIFICATION.body,
    );
  }

  /** Copia local: solo el sí o no del perfil (para reprogramar sin internet). */
  private async updateLocalCopy(studentId: string, enabled: boolean): Promise<void> {
    const [owner, profiles] = await Promise.all([
      this.store.owner().catch(() => null),
      this.store.profiles().catch(() => []),
    ]);
    if (!owner) return;
    const updated = profiles.map((p) => (p.id === studentId ? { ...p, streakReminder: enabled } : p));
    await this.store.saveProfiles(updated, owner).catch(() => undefined);
  }

  private today(): string {
    const d = this.now();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  private practicedOn(day: string): Set<string> {
    const ids = new Set<string>();
    for (const key of this.practiced) {
      const [d, id] = key.split('|');
      if (d === day) ids.add(id);
    }
    return ids;
  }
}
