import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { PROFILES_TTL_SECONDS } from '../offline/offline.model';
import { OfflineStore } from '../offline/offline-store.port';
import { ParentalSession } from '../parental/parental-session';
import { ProfilesPort } from '../profiles/profiles.port';
import { localDay } from '../time/local-day';
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
 *   Lo que dice el servidor (racha leída en "¿Quién practica?") y lo anotado en el equipo tras
 *   responder se juntan: ninguna fuente borra a la otra.
 * - ACTIVACIÓN POR EQUIPO: además del sí del servidor, el adulto tiene que haberlo activado desde el
 *   panel de ESTE equipo (con el permiso del sistema). Así una tablet que usa el niño no empieza a
 *   mostrar avisos solo porque el tutor lo activó en su teléfono.
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

  /**
   * Una sola vez al iniciar la app: escucha cambios de la copia local, la vuelta a primer plano
   * (sin depender de que la purga avise) y el toque del aviso.
   */
  start(
    openProfiles: () => void,
    doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
  ): void {
    if (this.started) return;
    this.started = true;
    this.store.onChange(() => void this.reschedule());
    doc?.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible') void this.reschedule();
    });
    if (this.notifier.supported()) this.notifier.onTap(openProfiles);
    void this.reschedule();
  }

  /**
   * Recalcula el único aviso. `practicedToday`: perfiles que se sabe que ya practicaron hoy (por
   * ejemplo, leídos del servidor). Sin esa información se respeta el aviso ya programado.
   * Las llamadas van en fila: dos a la vez no programan dos avisos.
   */
  reschedule(practicedToday?: ReadonlySet<string>): Promise<void> {
    // Lo que llega se suma a lo ya sabido hoy (no lo reemplaza).
    const day = this.today();
    for (const id of practicedToday ?? []) this.practiced.add(`${day}|${id}`);
    const fresh = practicedToday !== undefined;
    const run = () => this.run(fresh).catch(() => undefined);
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  /** Tras una respuesta (con o sin red): ese perfil ya practicó hoy. */
  notePractice(studentId: string): Promise<void> {
    const day = this.today();
    const key = `${day}|${studentId}`;
    if (this.practiced.has(key)) return Promise.resolve();
    this.practiced.add(key);
    return this.reschedule(new Set([studentId]));
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
    await this.refreshLocalCopy();
    // Activación por equipo: solo este equipo queda marcado (los demás, cuando el adulto lo active
    // en su panel). Desactivar lo apaga en el servidor, y cada equipo lo cancela al recargar.
    await this.store.setDeviceReminder(studentId, enabled).catch(() => undefined);
    // Con información nueva: si el perfil recién activado no practicó hoy, el aviso vuelve a hoy.
    await this.reschedule(new Set());
    return 'ok';
  }

  private async run(fresh: boolean): Promise<void> {
    if (!this.notifier.supported()) return;
    const now = this.now();
    const nowS = Math.floor(now.getTime() / 1000);
    const [owner, profiles, here] = await Promise.all([
      this.store.owner().catch(() => null),
      this.store.profiles().catch(() => []),
      this.store.deviceReminders().catch(() => [] as string[]),
    ]);
    // Copia vencida o sin dueño: como si no hubiera perfiles (no quedan avisos huérfanos).
    const valid = owner !== null && owner.savedAt + PROFILES_TTL_SECONDS > nowS;
    const activeHere = new Set(here);
    const enabled = valid
      ? profiles.filter((p) => p.streakReminder === true && !p.blocked && activeHere.has(p.id))
      : [];
    if (enabled.length === 0) {
      await this.notifier.cancel();
      return;
    }
    const known = this.practicedOn(this.today());
    // También cuenta lo practicado sin red que sigue en la cola de hoy: sobrevive a que el sistema
    // cierre la app (lo anotado en memoria se pierde, la cola no).
    const today = localDay(now);
    for (const p of enabled) {
      if (known.has(p.id)) continue;
      const queued = await this.store.queue(p.id).catch(() => []);
      if (queued.some((a) => a.localDate === today)) known.add(p.id);
    }
    const allPracticed = enabled.every((p) => known.has(p.id));
    const next = nextReminderAt(now, allPracticed);
    const pending = await this.notifier.pending().catch(() => null);
    // Ya está a esa hora (con un minuto de tolerancia por redondeos del sistema): no se toca.
    if (pending && Math.abs(pending.getTime() - next.getTime()) < 60_000) return;
    // Sin información nueva y con un aviso futuro: se respeta (salvo que todos ya practicaron).
    if (!fresh && !allPracticed && pending && pending > now) return;
    await this.notifier.schedule(
      next,
      STREAK_REMINDER_NOTIFICATION.title,
      STREAK_REMINDER_NOTIFICATION.body,
    );
  }

  /** Copia local: solo el sí o no del perfil (para reprogramar sin internet). */
  /**
   * Tras guardar en el servidor, la copia local se rehace con la lista del servidor (fuente de
   * verdad) y con fecha nueva, en UNA escritura: así no se pisa un cambio hecho entre medio y,
   * aunque la copia no existiera o estuviera vencida, el equipo puede programar el aviso.
   */
  private async refreshLocalCopy(): Promise<void> {
    const tutorId = this.injector.get(AuthPort).user()?.id;
    if (!tutorId) return;
    try {
      const profiles = await this.injector.get(ProfilesPort).list();
      const savedAt = Math.floor(this.now().getTime() / 1000);
      await this.store.saveProfiles(profiles, { tutorId, savedAt });
    } catch {
      // Sin la lista no se toca la copia: el aviso se ajusta al cargar "¿Quién practica?".
    }
  }

  private today(): string {
    const d = this.now();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  /** Quién practicó `day`. De paso olvida los días anteriores (no crece sin límite). */
  private practicedOn(day: string): Set<string> {
    const ids = new Set<string>();
    for (const key of [...this.practiced]) {
      const [d, id] = key.split('|');
      if (d === day) ids.add(id);
      else this.practiced.delete(key);
    }
    return ids;
  }

  /** ¿El recordatorio de este perfil está activo en este equipo? (para el panel). */
  async activeHere(studentId: string): Promise<boolean> {
    return (await this.store.deviceReminders().catch(() => [] as string[])).includes(studentId);
  }
}
