import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { MemoryOfflineStore } from '../core/offline/memory-offline-store';
import { OFFLINE_MESSAGES, OfflineNoticeComponent } from '../core/offline/offline-notice.component';
import { OfflineStore } from '../core/offline/offline-store.port';
import { avatarFor } from '../core/profiles/avatar';
import { Profile, ProfilesPort } from '../core/profiles/profiles.port';
import { ProgressPort } from '../core/progress/progress.port';
import { ProfilesPage } from './profiles.page';

const ANA: Profile = { id: 'p-ana', nickname: 'Ana', grade: 2, blocked: false };
const BETO: Profile = { id: 'p-beto', nickname: 'Beto', grade: 3, blocked: true };
const CATA: Profile = { id: 'p-cata', nickname: 'Cata', grade: 4, blocked: false };
const DANI: Profile = { id: 'p-dani', nickname: 'Dani', grade: 1, blocked: false };
const OWNER = { tutorId: 'tutor-1', savedAt: Math.floor(Date.now() / 1000) };

function setup(
  list: () => Promise<Profile[]> = async () => [ANA, BETO],
  dailyStreak: (id: string) => Promise<number> = async () => 3,
  store: MemoryOfflineStore = new MemoryOfflineStore(),
) {
  const profiles = { list: vi.fn(list), create: vi.fn(), remove: vi.fn() };
  const progress = {
    get: vi.fn(async (id: string) => ({
      total: 0,
      correct: 0,
      streak: 0,
      dailyStreak: await dailyStreak(id),
      practicedToday: false,
      byTopic: [],
      recent: [],
    })),
  };
  const nav = { navigateForward: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    declarations: [ProfilesPage, MascotComponent],
    imports: [IonicModule.forRoot(), OfflineNoticeComponent],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: ProfilesPort, useValue: profiles },
      { provide: ProgressPort, useValue: progress },
      { provide: NavController, useValue: nav },
      { provide: OfflineStore, useValue: store },
      { provide: AuthPort, useValue: { user: signal({ id: 'tutor-1', email: 'a@b.test' }) } },
    ],
  });
  const fixture = TestBed.createComponent(ProfilesPage);
  return { page: fixture.componentInstance, fixture, profiles, progress, nav, store };
}

/** Deja que Angular llame a ngOnInit (una sola vez) y espera las cargas. */
async function render(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
}

function el(fixture: { nativeElement: unknown }): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('ProfilesPage (¿Quién practica?)', () => {
  it('muestra una tarjeta por niño con su animalito, curso y racha', async () => {
    const { page, fixture } = setup();
    await render(fixture);
    const ana = el(fixture).querySelector('[data-testid="kid-Ana"]');
    expect(ana?.textContent).toContain(avatarFor('p-ana').emoji);
    expect(ana?.textContent).toContain('2° básico');
    expect(ana?.textContent).toContain('3 días seguidos');
    expect(page.message).toBe('¿Quién va a practicar hoy?');
  });

  it('no permite crear ni borrar perfiles aquí', async () => {
    const { page, fixture } = setup();
    await render(fixture);
    const text = el(fixture).textContent ?? '';
    expect(text).not.toContain('Borrar');
    expect(text).not.toContain('Eliminar');
    expect(text).not.toContain('Crear perfil');
  });

  it('la tarjeta del centro entra con "¡A practicar!" o al tocarla; "Mi progreso" abre el progreso', async () => {
    const { fixture, nav } = setup();
    await render(fixture);
    const ana = el(fixture).querySelector('[data-testid="kid-Ana"]') as HTMLElement;
    (ana.querySelector('[data-testid="practice-btn"]') as HTMLElement).click();
    expect(nav.navigateForward).toHaveBeenCalledTimes(1);
    expect(nav.navigateForward).toHaveBeenCalledWith(['/practica', 'p-ana']);
    nav.navigateForward.mockClear();
    ana.click();
    expect(nav.navigateForward).toHaveBeenCalledWith(['/practica', 'p-ana']);
    nav.navigateForward.mockClear();
    (ana.querySelector('.progress-btn') as HTMLElement).click();
    expect(nav.navigateForward).toHaveBeenCalledTimes(1);
    expect(nav.navigateForward).toHaveBeenCalledWith(['/progreso', 'p-ana']);
  });

  it('tocar una tarjeta del lado la centra sin entrar; solo la del centro tiene botones', async () => {
    const { page, fixture, nav } = setup(async () => [ANA, CATA]);
    await render(fixture);
    expect(page.active).toBe(0);
    const cata = el(fixture).querySelector('[data-testid="kid-Cata"]') as HTMLElement;
    expect(cata.querySelector('[data-testid="practice-btn"]')).toBeNull();
    cata.click();
    fixture.detectChanges();
    expect(nav.navigateForward).not.toHaveBeenCalled();
    expect(page.active).toBe(1);
    expect(cata.querySelector('[data-testid="practice-btn"]')).not.toBeNull();
    expect(el(fixture).querySelector('[data-testid="kid-Ana"] [data-testid="practice-btn"]')).toBeNull();
  });

  it('las flechas, los puntos y el teclado mueven el carrusel', async () => {
    const { page, fixture } = setup(async () => [ANA, CATA, DANI]);
    await render(fixture);
    const prev = el(fixture).querySelector('[data-testid="carousel-prev"]') as HTMLButtonElement;
    const next = el(fixture).querySelector('[data-testid="carousel-next"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    next.click();
    fixture.detectChanges();
    expect(page.active).toBe(1);
    const dots = el(fixture).querySelectorAll('[data-testid="carousel-dot"]');
    expect(dots).toHaveLength(3);
    expect(dots[1].getAttribute('aria-current')).toBe('true');
    expect(dots[2].getAttribute('aria-label')).toBe('Ir al perfil de Dani');
    (dots[2] as HTMLElement).click();
    fixture.detectChanges();
    expect(page.active).toBe(2);
    expect(next.disabled).toBe(true);
    page.onKey(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(page.active).toBe(1);
    page.onKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    page.onKey(new KeyboardEvent('keydown', { key: 'ArrowRight' })); // ya está en la última
    expect(page.active).toBe(2);
  });

  it('cada tarjeta dice quién es y su posición; con un solo perfil no hay flechas ni puntos', async () => {
    const { fixture } = setup(async () => [ANA]);
    await render(fixture);
    const ana = el(fixture).querySelector('[data-testid="kid-Ana"]');
    expect(ana?.getAttribute('aria-label')).toBe('Ana, 2° básico, perfil 1 de 1');
    expect(el(fixture).querySelector('[data-testid="carousel-next"]')).toBeNull();
    expect(el(fixture).querySelector('[data-testid="carousel-dot"]')).toBeNull();
  });

  it('un perfil en pausa se ve apagado, se puede centrar pero no abre la práctica', async () => {
    const { page, fixture, nav, progress } = setup();
    await render(fixture);
    const beto = el(fixture).querySelector('[data-testid="kid-Beto"]') as HTMLElement;
    expect(beto.classList).toContain('paused');
    expect(beto.textContent).toContain('En pausa');
    expect(beto.getAttribute('aria-label')).toContain('en pausa');
    beto.click(); // la centra
    fixture.detectChanges();
    expect(page.active).toBe(1);
    expect(beto.querySelector('[data-testid="practice-btn"]')).toBeNull();
    beto.click(); // ya al centro: igual no entra
    expect(nav.navigateForward).not.toHaveBeenCalled();
    expect(progress.get).not.toHaveBeenCalledWith('p-beto');
  });

  it('si la racha no carga, la tarjeta se ve igual sin la racha', async () => {
    const { page, fixture } = setup(undefined, async () => {
      throw new Error('red');
    });
    await render(fixture);
    const ana = el(fixture).querySelector('[data-testid="kid-Ana"]');
    expect(ana).not.toBeNull();
    expect(ana?.textContent).not.toContain('días seguidos');
  });

  it('sin perfiles pide a un adulto que los cree en el Panel', async () => {
    const { page, fixture } = setup(async () => []);
    await render(fixture);
    expect(el(fixture).querySelector('[data-testid="no-profiles"]')?.textContent).toContain(
      'Panel del tutor',
    );
  });

  it('si la base no responde muestra un error amable', async () => {
    const { page, fixture } = setup(async () => {
      throw new Error('red');
    });
    await render(fixture);
    expect(page.error).toContain('No pude cargar los perfiles');
  });

  describe('sin conexión (CU-A12)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('si "Mi progreso" no abre por falta de conexión (falla de red), avisa junto a la tarjeta', async () => {
      const { fixture, page, nav } = setup();
      await render(fixture);
      nav.navigateForward.mockResolvedValue(false);
      TestBed.inject(ConnectivityService).reportNetworkFailure();
      await page.progress(page.cards[0]);
      fixture.detectChanges();
      expect(el(fixture).querySelector('[data-testid="offline-needs-internet"]')?.textContent).toContain(
        OFFLINE_MESSAGES.needsInternet,
      );
    });

    it('con conexión guarda una copia local con solo apodo, curso y pausa', async () => {
      const { fixture, store } = setup();
      await render(fixture);
      expect(store.cachedProfiles).toEqual([
        { id: ANA.id, nickname: 'Ana', grade: 2, blocked: false, streakReminder: false },
        { id: BETO.id, nickname: 'Beto', grade: 3, blocked: true, streakReminder: false },
      ]);
      // La copia queda ligada al tutor de la sesión (para borrarla si entra otro).
      expect(store.cachedOwner?.tutorId).toBe('tutor-1');
      expect(el(fixture).querySelector('[data-testid="offline-banner"]')).toBeNull();
    });

    it('sin red muestra la copia local y el aviso, sin racha; "Mi progreso" avisa que necesita internet', async () => {
      const store = new MemoryOfflineStore();
      await store.saveProfiles([ANA, BETO], OWNER);
      const { fixture, profiles, progress } = setup(undefined, undefined, store);
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      TestBed.inject(ConnectivityService).reportNetworkFailure();
      await render(fixture);
      const root = el(fixture);
      expect(profiles.list).not.toHaveBeenCalled();
      expect(progress.get).not.toHaveBeenCalled();
      expect(root.querySelector('[data-testid="offline-banner"]')?.textContent).toContain(
        'Estás sin internet',
      );
      expect(root.querySelector('[data-testid="kid-Ana"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="practice-btn"]')).not.toBeNull();
      // El botón sigue visible, pero no navega: avisa en lenguaje simple.
      const progressBtn = root.querySelector('[data-testid="progress-btn"]') as HTMLElement;
      expect(progressBtn).not.toBeNull();
      progressBtn.click();
      fixture.detectChanges();
      expect(TestBed.inject(NavController).navigateForward).not.toHaveBeenCalled();
      expect(root.querySelector('[data-testid="offline-needs-internet"]')?.textContent).toContain(
        OFFLINE_MESSAGES.needsInternet,
      );
    });

    it('si la base no responde pero hay copia local, se usa la copia', async () => {
      const store = new MemoryOfflineStore();
      await store.saveProfiles([ANA], OWNER);
      const { fixture, page } = setup(async () => {
        throw new Error('profiles_unavailable');
      }, undefined, store);
      await render(fixture);
      expect(page.offlineMode).toBe(true);
      expect(page.error).toBe('');
      expect(page.cards.map((c) => c.profile.nickname)).toEqual(['Ana']);
    });
  });
});
