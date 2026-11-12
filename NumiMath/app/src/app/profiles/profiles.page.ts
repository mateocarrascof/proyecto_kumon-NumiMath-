import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  inject,
} from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { MascotPort } from '../core/mascot/mascot.port';
import { isOffline } from '../core/offline/offline-access';
import { StreakReminderService } from '../core/reminders/streak-reminder.service';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { OFFLINE_MESSAGES } from '../core/offline/offline-notice.component';
import { OfflineStore } from '../core/offline/offline-store.port';
import { Avatar, avatarFor } from '../core/profiles/avatar';
import { Profile, ProfilesPort } from '../core/profiles/profiles.port';
import { daysLabel } from '../core/progress/daily-streak';
import { ProgressPort } from '../core/progress/progress.port';

export interface KidCard {
  profile: Profile;
  avatar: Avatar;
  /** Días seguidos; `null` si no se pudo leer (no se muestra). */
  days: number | null;
}

/**
 * "¿Quién va a practicar hoy?": pantalla para el NIÑO. Solo elegir perfil y ver su progreso.
 * Crear y eliminar perfiles está en el Panel del tutor, protegido con PIN.
 */
@Component({
  selector: 'app-profiles',
  templateUrl: 'profiles.page.html',
  styleUrls: ['profiles.page.scss'],
  standalone: false,
})
export class ProfilesPage implements OnInit {
  private readonly profilesPort = inject(ProfilesPort);
  private readonly progressPort = inject(ProgressPort);
  private readonly nav = inject(NavController);
  protected readonly mascot = inject(MascotPort);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly offlineStore = inject(OfflineStore);
  private readonly connectivity = inject(ConnectivityService);
  private readonly auth = inject(AuthPort);
  private readonly reminders = inject(StreakReminderService);

  cards: KidCard[] = [];
  /** CU-A12: sin conexión se muestra la copia local de los perfiles (solo apodo y curso). */
  offlineMode = false;
  protected readonly offlineMessages = OFFLINE_MESSAGES;
  /** Aviso puntual sin conexión (por ejemplo, al tocar "Mi progreso"). */
  offlineNotice = '';
  /** Tarjeta al centro del carrusel: la única que entra a practicar. */
  active = 0;
  private scrollFrame = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.scrollFrame && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.scrollFrame);
      }
    });
  }
  loading = true;
  error = '';
  protected readonly daysLabel = daysLabel;

  get message(): string {
    if (this.loading || this.error) return '';
    return this.cards.length ? '¿Quién va a practicar hoy?' : '¡Hola! Todavía no hay perfiles.';
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.mascot.set('thinking');
    try {
      const profiles = await this.loadProfiles();
      this.cards = profiles.map((profile) => ({ profile, avatar: avatarFor(profile.id), days: null }));
      this.active = 0;
      this.error = '';
      this.mascot.set('happy');
    } catch {
      this.error = 'No pude cargar los perfiles. Revisa que la base esté encendida.';
      this.mascot.set('sad');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
    // Ya dibujadas las tarjetas, la primera queda al centro (sin animación).
    this.cdr.detectChanges();
    this.recenter();
    // La racha la calcula el servidor: sin conexión no se muestra.
    if (!this.offlineMode) await this.loadStreaks();
    // La racha cambia el alto de las tarjetas: se vuelve a centrar por si el navegador movió la pista.
    this.cdr.detectChanges();
    this.recenter();
  }

  /**
   * Con conexión: la lista de la base, y se guarda una copia local (solo apodo, curso y si está
   * en pausa) para poder elegir perfil sin internet. Sin conexión, o si la base no responde:
   * esa copia. Si no hay copia, se muestra el error de siempre.
   */
  private async loadProfiles(): Promise<Profile[]> {
    // Se intenta en línea si el navegador cree que hay red (no basta `navigator.onLine`: la copia
    // se usa solo si la lectura falla).
    if (this.connectivity.browserOnline()) {
      try {
        const profiles = await this.profilesPort.list();
        this.offlineMode = false;
        this.connectivity.reportSuccess();
        // La copia queda ligada a este tutor y vale 7 días.
        const tutorId = this.auth.user()?.id;
        if (tutorId) {
          const savedAt = Math.floor(Date.now() / 1000);
          await this.offlineStore.saveProfiles(profiles, { tutorId, savedAt }).catch(() => undefined);
        }
        return profiles;
      } catch {
        // Puede ser falta de red: se prueba con la copia local.
      }
    }
    const cached = await this.offlineStore.profiles().catch(() => []);
    if (!cached.length) throw new Error('profiles_unavailable');
    this.offlineMode = true;
    return [...cached].sort((a, b) => a.nickname.localeCompare(b.nickname));
  }

  practice(card: KidCard): Promise<boolean> | void {
    if (card.profile.blocked) return;
    return this.nav.navigateForward(['/practica', card.profile.id]);
  }

  /** Tocar una tarjeta: si está a un lado, se centra; si ya está al centro, entra a practicar. */
  select(index: number): Promise<boolean> | void {
    if (index !== this.active) {
      this.goTo(index);
      return;
    }
    return this.practice(this.cards[index]);
  }

  /** Lleva la tarjeta `index` al centro del carrusel (`smooth = false`: sin animación). */
  goTo(index: number, smooth = true): void {
    if (index < 0 || index >= this.cards.length) return;
    this.active = index;
    this.cdr.markForCheck();
    const track = this.track();
    const item = track?.children.item(index) as HTMLElement | null;
    if (!track || !item || typeof track.scrollTo !== 'function') return;
    const calm =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = item.offsetLeft + item.offsetWidth / 2 - track.clientWidth / 2;
    track.scrollTo({ left, behavior: smooth && !calm ? 'smooth' : 'auto' });
  }

  /** Al girar el dispositivo o cambiar el tamaño, la tarjeta elegida vuelve al centro. */
  @HostListener('window:resize')
  recenter(): void {
    this.goTo(this.active, false);
  }

  /** Flechas del teclado dentro del carrusel. */
  onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') this.goTo(this.active + 1);
    else if (event.key === 'ArrowLeft') this.goTo(this.active - 1);
    else return;
    event.preventDefault();
  }

  /** Al deslizar con el dedo: la tarjeta más cercana al centro pasa a ser la activa. */
  onScroll(): void {
    if (this.scrollFrame || typeof requestAnimationFrame !== 'function') return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      const track = this.track();
      if (!track) return;
      const center = track.scrollLeft + track.clientWidth / 2;
      let best = this.active;
      let bestDistance = Infinity;
      Array.from(track.children).forEach((child, i) => {
        const el = child as HTMLElement;
        const distance = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      if (best !== this.active) {
        this.active = best;
        this.cdr.detectChanges();
      }
    });
  }

  /** Texto para el lector de pantalla de cada tarjeta. */
  cardLabel(card: KidCard, index: number): string {
    const state = card.profile.blocked ? ', en pausa' : '';
    return `${card.profile.nickname}, ${card.profile.grade}° básico${state}, perfil ${index + 1} de ${this.cards.length}`;
  }

  private track(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('[data-testid="carousel-track"]');
  }

  progress(card: KidCard, event?: Event): Promise<boolean> {
    // El botón está dentro de la tarjeta: que no abra también la práctica.
    event?.stopPropagation();
    // El progreso lo calcula el servidor. Sin red se avisa sin intentar; si el navegador cree que
    // hay red se intenta, y si el guard no deja pasar por falta de conexión, también se avisa.
    if (this.offlineMode && !this.connectivity.browserOnline()) {
      this.offlineNotice = OFFLINE_MESSAGES.needsInternet;
      return Promise.resolve(false);
    }
    return this.nav.navigateForward(['/progreso', card.profile.id]).then((opened) => {
      if (!opened && isOffline(this.connectivity)) {
        this.offlineNotice = OFFLINE_MESSAGES.needsInternet;
        this.cdr.markForCheck();
      }
      return opened;
    });
  }

  /** Racha de cada perfil. Mejor esfuerzo: si falla, la tarjeta se ve igual sin la racha. */
  private async loadStreaks(): Promise<void> {
    const practicedToday = new Set<string>();
    await Promise.all(
      this.cards
        .filter((c) => !c.profile.blocked)
        .map(async (card) => {
          try {
            const progress = await this.progressPort.get(card.profile.id);
            card.days = progress.dailyStreak;
            if (progress.practicedToday) practicedToday.add(card.profile.id);
          } catch {
            card.days = null;
          }
        }),
    );
    // CU-A9: si todos los perfiles con recordatorio ya practicaron hoy, el aviso pasa a mañana.
    void this.reminders.reschedule(practicedToday);
    this.cdr.markForCheck();
  }
}
