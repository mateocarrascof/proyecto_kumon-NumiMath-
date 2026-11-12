import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { MemoryOfflineStore } from '../offline/memory-offline-store';
import { CachedProfile, PROFILES_TTL_SECONDS } from '../offline/offline.model';
import { OfflineStore } from '../offline/offline-store.port';
import { ParentalSession } from '../parental/parental-session';
import { ReminderNotifier } from './reminder-notifier.port';
import { STREAK_REMINDER_NOTIFICATION } from './streak-reminder.messages';
import { StreakReminderService, nextReminderAt } from './streak-reminder.service';

// Miércoles 12 de noviembre de 2026, 10:00 hora local.
const tick = () => new Promise((r) => setTimeout(r, 0));

const MORNING = new Date(2026, 10, 12, 10, 0);
const EVENING = new Date(2026, 10, 12, 19, 0);
const TODAY_18 = new Date(2026, 10, 12, 18, 0);
const TOMORROW_18 = new Date(2026, 10, 13, 18, 0);

const ANA: CachedProfile = { id: 'p-ana', nickname: 'Ana', grade: 2, blocked: false, streakReminder: true };
const BETO: CachedProfile = { id: 'p-beto', nickname: 'Beto', grade: 3, blocked: false, streakReminder: true };
const CATA: CachedProfile = { id: 'p-cata', nickname: 'Cata', grade: 1, blocked: false, streakReminder: false };

class FakeNotifier extends ReminderNotifier {
  scheduled: { at: Date; title: string; body: string } | null = null;
  permission = true;
  isSupported = true;
  tap: (() => void) | null = null;
  supported = () => this.isSupported;
  requestPermission = vi.fn(async () => this.permission);
  pending = async () => this.scheduled?.at ?? null;
  schedule = vi.fn(async (at: Date, title: string, body: string) => {
    this.scheduled = { at, title, body };
  });
  cancel = vi.fn(async () => {
    this.scheduled = null;
  });
  onTap = (handler: () => void) => {
    this.tap = handler;
  };
}

async function setup(profiles: CachedProfile[] = [ANA], now = MORNING, savedAt?: number) {
  const store = new MemoryOfflineStore();
  const nowS = Math.floor(now.getTime() / 1000);
  await store.saveProfiles(profiles, { tutorId: 't', savedAt: savedAt ?? nowS });
  const notifier = new FakeNotifier();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: OfflineStore, useValue: store },
      { provide: ReminderNotifier, useValue: notifier },
      { provide: AuthPort, useValue: { accessToken: async () => 'jwt' } },
    ],
  });
  const service = TestBed.inject(StreakReminderService);
  let clock = now;
  service.now = () => clock;
  return { service, store, notifier, setNow: (d: Date) => (clock = d) };
}

describe('nextReminderAt (CU-A9)', () => {
  it('antes de las 18:00: hoy; después, o si ya practicaron: mañana', () => {
    expect(nextReminderAt(MORNING, false)).toEqual(TODAY_18);
    expect(nextReminderAt(EVENING, false)).toEqual(TOMORROW_18);
    expect(nextReminderAt(MORNING, true)).toEqual(TOMORROW_18);
  });
});

describe('StreakReminderService (CU-A9)', () => {
  it('apagado por defecto: sin perfiles con recordatorio no programa nada', async () => {
    const { service, notifier } = await setup([CATA]);
    await service.reschedule();
    expect(notifier.schedule).not.toHaveBeenCalled();
    expect(notifier.cancel).toHaveBeenCalled();
  });

  it('programa UN solo aviso a las 18:00, sin apodo ni quién no practicó', async () => {
    const { service, notifier } = await setup([ANA, BETO]);
    await service.reschedule();
    expect(notifier.schedule).toHaveBeenCalledTimes(1);
    expect(notifier.scheduled).toEqual({
      at: TODAY_18,
      title: STREAK_REMINDER_NOTIFICATION.title,
      body: STREAK_REMINDER_NOTIFICATION.body,
    });
    expect(notifier.scheduled?.body).not.toMatch(/Ana|Beto/);
  });

  it('el texto es amable: sin culpa, sin urgencia, sin "te espera" y sin emoji', () => {
    const { title, body } = STREAK_REMINDER_NOTIFICATION;
    expect(body).toBe('Numi tiene ejercicios listos para practicar un ratito.');
    expect(`${title} ${body}`).not.toMatch(/perd|racha|te espera|ya|rápido|!/i);
    expect(`${title} ${body}`).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('si todos los perfiles con recordatorio practicaron hoy, pasa a mañana', async () => {
    const { service, notifier } = await setup([ANA, BETO]);
    await service.reschedule(new Set(['p-ana', 'p-beto']));
    expect(notifier.scheduled?.at).toEqual(TOMORROW_18);
  });

  it('si solo uno practicó, se mantiene hoy (un aviso para el equipo)', async () => {
    const { service, notifier } = await setup([ANA, BETO]);
    await service.reschedule(new Set(['p-ana']));
    expect(notifier.scheduled?.at).toEqual(TODAY_18);
  });

  it('tras practicar (con o sin red), con un solo perfil, el aviso pasa a mañana', async () => {
    const { service, notifier } = await setup([ANA]);
    await service.reschedule();
    await service.notePractice('p-ana');
    expect(notifier.scheduled?.at).toEqual(TOMORROW_18);
  });

  it('al abrir la app sin información nueva respeta el aviso ya programado', async () => {
    const { service, notifier } = await setup([ANA]);
    await service.reschedule(new Set(['p-ana'])); // mañana
    notifier.schedule.mockClear();
    await service.reschedule();
    expect(notifier.schedule).not.toHaveBeenCalled();
    expect(notifier.scheduled?.at).toEqual(TOMORROW_18);
  });

  it('pasadas las 18:00 programa para mañana (máximo uno por día)', async () => {
    const { service, notifier } = await setup([ANA], EVENING);
    await service.reschedule();
    expect(notifier.scheduled?.at).toEqual(TOMORROW_18);
  });

  it('un perfil en pausa no recibe aviso', async () => {
    const { service, notifier } = await setup([{ ...ANA, blocked: true }]);
    await service.reschedule();
    expect(notifier.scheduled).toBeNull();
  });

  it('en la web (sin plugin) no hace nada', async () => {
    const { service, notifier } = await setup([ANA]);
    notifier.isSupported = false;
    await service.reschedule();
    expect(notifier.schedule).not.toHaveBeenCalled();
    expect(notifier.cancel).not.toHaveBeenCalled();
  });

  describe('se cancela cuando cambia lo guardado', () => {
    async function started(profiles: CachedProfile[] = [ANA]) {
      const ctx = await setup(profiles);
      ctx.service.start(() => undefined);
      await ctx.service.reschedule();
      expect(ctx.notifier.scheduled).not.toBeNull();
      return ctx;
    }
    const settle = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    it('al cerrar sesión, revocar el consentimiento o entrar otro tutor (se borra todo)', async () => {
      const { store, notifier } = await started();
      await store.clear();
      await settle();
      expect(notifier.scheduled).toBeNull();
    });

    it('al borrar el perfil', async () => {
      const { store, notifier } = await started();
      await store.forgetStudent('p-ana');
      await settle();
      expect(notifier.scheduled).toBeNull();
    });

    it('al pausar (bloquear) el perfil', async () => {
      const { store, notifier } = await started();
      await store.saveProfiles([{ ...ANA, blocked: true }], { tutorId: 't', savedAt: Math.floor(MORNING.getTime() / 1000) });
      await settle();
      expect(notifier.scheduled).toBeNull();
    });

    it('cuando la purga elimina la copia local vencida', async () => {
      const { service, store, notifier, setNow } = await started();
      const later = new Date(MORNING.getTime() + PROFILES_TTL_SECONDS * 1000);
      setNow(later);
      await store.purgeExpired(Math.floor(later.getTime() / 1000));
      await settle();
      await service.reschedule();
      expect(notifier.scheduled).toBeNull();
    });

    it('al desactivar el recordatorio de todos los perfiles', async () => {
      const { store, notifier } = await started();
      await store.saveProfiles([{ ...ANA, streakReminder: false }], { tutorId: 't', savedAt: Math.floor(MORNING.getTime() / 1000) });
      await settle();
      expect(notifier.scheduled).toBeNull();
    });
  });

  it('una copia local vencida no deja avisos huérfanos', async () => {
    const nowS = Math.floor(MORNING.getTime() / 1000);
    const { service, notifier } = await setup([ANA], MORNING, nowS - PROFILES_TTL_SECONDS);
    notifier.scheduled = { at: TODAY_18, title: 't', body: 'b' };
    await service.reschedule();
    expect(notifier.scheduled).toBeNull();
  });

  it('al tocar el aviso abre "¿Quién practica?"', async () => {
    const { service, notifier } = await setup([ANA]);
    const open = vi.fn();
    service.start(open);
    notifier.tap?.();
    expect(open).toHaveBeenCalled();
  });

  describe('setEnabled (solo panel del tutor)', () => {
    const URL = `${environment.apiUrl}/v1/students/p-ana/streak-reminder`;

    it('al activar pide el permiso; si se niega, no guarda nada', async () => {
      const { service, notifier } = await setup([{ ...ANA, streakReminder: false }]);
      notifier.permission = false;
      expect(await service.setEnabled('p-ana', true)).toBe('denied');
      TestBed.inject(HttpTestingController).expectNone(URL);
    });

    it('con permiso: guarda con el token del PIN, actualiza la copia local y programa', async () => {
      const { service, store, notifier } = await setup([{ ...ANA, streakReminder: false }]);
      vi.spyOn(TestBed.inject(ParentalSession), 'header').mockReturnValue({ 'X-Parental-Token': 'pin-tok' });
      const pending = service.setEnabled('p-ana', true);
      const http = TestBed.inject(HttpTestingController);
      await tick();
      const req = http.expectOne(URL);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ enabled: true });
      expect(req.request.headers.get('X-Parental-Token')).toBe('pin-tok');
      req.flush({ enabled: true });
      expect(await pending).toBe('ok');
      expect((await store.profiles())[0].streakReminder).toBe(true);
      expect(notifier.scheduled?.at).toEqual(TODAY_18);
    });

    it('al desactivar no pide permiso y cancela el aviso', async () => {
      const { service, notifier } = await setup([ANA]);
      await service.reschedule();
      const pending = service.setEnabled('p-ana', false);
      const http = TestBed.inject(HttpTestingController);
      await tick();
      http.expectOne(URL).flush({ enabled: false });
      expect(await pending).toBe('ok');
      expect(notifier.requestPermission).not.toHaveBeenCalled();
      expect(notifier.scheduled).toBeNull();
    });

    it('con el PIN vencido devuelve "pin" y no cambia nada', async () => {
      const { service, store } = await setup([{ ...ANA, streakReminder: false }]);
      const pending = service.setEnabled('p-ana', true);
      const http = TestBed.inject(HttpTestingController);
      await tick();
      http.expectOne(URL).flush({}, { status: 401, statusText: 'x' });
      expect(await pending).toBe('pin');
      expect((await store.profiles())[0].streakReminder).toBe(false);
    });

    it('en la web no se puede activar', async () => {
      const { service, notifier } = await setup([{ ...ANA, streakReminder: false }]);
      notifier.isSupported = false;
      expect(await service.setEnabled('p-ana', true)).toBe('unsupported');
    });
  });
});
