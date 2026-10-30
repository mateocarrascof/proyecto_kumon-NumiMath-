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

import { MascotPort } from '../core/mascot/mascot.port';
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

  cards: KidCard[] = [];
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
      const profiles = await this.profilesPort.list();
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
    await this.loadStreaks();
    // La racha cambia el alto de las tarjetas: se vuelve a centrar por si el navegador movió la pista.
    this.cdr.detectChanges();
    this.recenter();
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
    return this.nav.navigateForward(['/progreso', card.profile.id]);
  }

  /** Racha de cada perfil. Mejor esfuerzo: si falla, la tarjeta se ve igual sin la racha. */
  private async loadStreaks(): Promise<void> {
    await Promise.all(
      this.cards
        .filter((c) => !c.profile.blocked)
        .map(async (card) => {
          try {
            card.days = (await this.progressPort.get(card.profile.id)).dailyStreak;
          } catch {
            card.days = null;
          }
        }),
    );
    this.cdr.markForCheck();
  }
}
