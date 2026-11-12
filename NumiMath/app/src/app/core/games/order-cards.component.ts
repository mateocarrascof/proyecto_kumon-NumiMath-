import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Injector,
  Output,
  SimpleChanges,
  afterNextRender,
  inject,
} from '@angular/core';

import { GAME_TEXT, optionLabel } from './games.messages';
import { GameOption } from './games.port';

/** Movimiento mínimo (px) para que un toque cuente como arrastre y no como toque. */
const DRAG_THRESHOLD = 8;

/**
 * Ordenar y completar con tarjetas (CU-A21). Una fila de lugares y un montón de tarjetas.
 *
 * - TOCAR es la forma principal: tocar una tarjeta la pone en el primer lugar libre; tocar una ya
 *   puesta la devuelve al montón.
 * - ARRASTRAR es la alternativa (Pointer Events: dedo y mouse, sin librerías): soltar sobre un
 *   lugar la pone ahí (o la intercambia); soltar fuera de los lugares la devuelve al montón.
 * - TECLADO: las tarjetas son botones (Enter o Espacio para poner y sacar); en una tarjeta puesta,
 *   las flechas izquierda y derecha la mueven de lugar.
 * - LECTOR DE PANTALLA: cada lugar dice su número y su contenido, y un aviso cortés cuenta cada
 *   cambio ("Pusiste 7 en el lugar 2").
 * - COMPLETAR: `slots` permite lugares ya ocupados y fijos (hoy los juegos del servidor solo piden
 *   ordenar; completar necesita un juego nuevo).
 */
@Component({
  selector: 'app-order-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="order">
      <p class="help">{{ text.orderHelp }}</p>
      <ol class="slots" [attr.aria-label]="text.orderSlots">
        @for (id of placed; track $index; let i = $index) {
          <li class="slot" [attr.data-slot]="i" [class.filled]="id !== null" [class.locked]="locked[i]">
            @if (id !== null) {
              <button
                type="button"
                class="card"
                [attr.data-slot-card]="i"
                [disabled]="disabled || locked[i]"
                [attr.aria-label]="slotAria(i)"
                (click)="onSlotClick(i)"
                (keydown)="onSlotKey($event, i)"
                (pointerdown)="startDrag($event, id)"
                (pointermove)="moveDrag($event)"
                (pointerup)="endDrag($event)"
                (pointercancel)="cancelDrag()"
                [attr.data-testid]="'slot-card-' + i"
              >
                {{ labelOf(id) }}
              </button>
              @if (correct && correct[i] === id) {
                <span class="ok" aria-hidden="true">✓</span>
              }
            } @else {
              <span class="empty" [attr.data-testid]="'slot-empty-' + i">
                <span aria-hidden="true">{{ i + 1 }}</span>
                <span class="sr-only">Lugar {{ i + 1 }}, vacío</span>
              </span>
            }
          </li>
        }
      </ol>

      <div class="pool" role="group" [attr.aria-label]="text.orderPool" data-pool>
        @for (c of pool(); track c.id) {
          <button
            type="button"
            class="card"
            [disabled]="disabled"
            [attr.aria-label]="'Poner ' + labelOf(c.id)"
            (click)="onPoolClick(c.id)"
            (pointerdown)="startDrag($event, c.id)"
            (pointermove)="moveDrag($event)"
            (pointerup)="endDrag($event)"
            (pointercancel)="cancelDrag()"
            [attr.data-testid]="'pool-' + c.id"
          >
            {{ c.label }}
          </button>
        }
      </div>

      @if (correct) {
        <p class="answer" data-testid="order-answer">
          {{ text.orderAnswer }} <strong>{{ correctLabels() }}</strong>
        </p>
      } @else {
        <button
          type="button"
          class="ready"
          [disabled]="disabled || !complete()"
          (click)="send()"
          data-testid="order-ready"
        >
          {{ text.ready }}
        </button>
      }
      <p class="sr-only" aria-live="polite" data-testid="order-live">{{ announcement }}</p>
    </div>
  `,
  styles: [
    `
      .order {
        max-width: 480px;
        margin: 0 auto;
      }
      .help {
        margin: 0 0 8px;
        font-size: 1rem;
      }
      .slots {
        list-style: none;
        display: flex;
        gap: 8px;
        padding: 0;
        margin: 0 0 16px;
        justify-content: center;
      }
      .slot {
        flex: 1 1 0;
        max-width: 80px;
        min-height: 72px;
        border: 3px dashed #4a5568;
        border-radius: 14px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .slot.filled {
        border-style: solid;
      }
      .empty {
        color: #4a5568;
        font-size: 1.1rem;
      }
      .ok {
        position: absolute;
        top: -10px;
        right: -6px;
        background: #1e7a3a;
        color: #fff;
        border-radius: 999px;
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        font-size: 0.9rem;
      }
      .pool {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: center;
        min-height: 72px;
      }
      .card {
        min-width: 64px;
        min-height: 64px; /* objetivo táctil grande */
        padding: 6px 10px;
        border-radius: 14px;
        border: 3px solid #1a56db;
        background: #ffffff;
        color: #1a202c;
        font: inherit;
        font-size: 1.8rem;
        font-weight: 700;
        touch-action: none; /* el arrastre no hace desplazar la página */
        cursor: grab;
        transition: transform 0.12s ease;
      }
      .slot .card {
        width: 100%;
      }
      .card:focus-visible,
      .ready:focus-visible {
        outline: 4px solid #1a56db;
        outline-offset: 3px;
      }
      .card.dragging {
        position: relative;
        z-index: 10;
        transition: none;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
      }
      .ready {
        display: block;
        width: 100%;
        min-height: 56px;
        margin-top: 16px;
        border: 0;
        border-radius: 16px;
        background: #1a56db;
        color: #fff;
        font: inherit;
        font-size: 1.25rem;
        font-weight: 700;
      }
      .ready:disabled {
        background: #a0aec0;
        color: #1a202c;
      }
      .answer {
        margin-top: 16px;
        font-size: 1.15rem;
        text-align: center;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        .card {
          transition: none;
        }
      }
    `,
  ],
})
export class OrderCardsComponent implements OnChanges {
  @Input({ required: true }) cards: GameOption[] = [];
  /** Lugares ya ocupados y fijos (para "completar"); `null` = todos vacíos. */
  @Input() slots: (string | null)[] | null = null;
  @Input() disabled = false;
  /** Después de corregir: el orden correcto (antes, null). */
  @Input() correct: string[] | null = null;
  /** Respuesta lista (todas las tarjetas puestas y el niño tocó "Listo"). */
  @Output() readonly ready = new EventEmitter<string[]>();

  protected readonly text = GAME_TEXT;
  placed: (string | null)[] = [];
  locked: boolean[] = [];
  announcement = '';

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private drag: {
    id: string;
    pointerId: number;
    x: number;
    y: number;
    el: HTMLElement;
    moved: boolean;
  } | null = null;
  /** Tras un arrastre, el navegador manda también un "click": se ignora. */
  private suppressClick = false;

  ngOnChanges(changes: SimpleChanges): void {
    // Solo un ejercicio nuevo (otras tarjetas o lugares) reinicia; al llegar la corrección no se
    // pierde lo que el niño ordenó.
    if (!changes['cards'] && !changes['slots']) return;
    const fixed = this.slots ?? this.cards.map(() => null);
    this.placed = [...fixed];
    this.locked = fixed.map((id) => id !== null);
    this.announcement = '';
  }

  pool(): GameOption[] {
    return this.cards.filter((c) => !this.placed.includes(c.id));
  }

  complete(): boolean {
    return this.placed.length > 0 && this.placed.every((id) => id !== null);
  }

  protected labelOf(id: string): string {
    const card = this.cards.find((c) => c.id === id);
    return card ? card.label : id;
  }

  private spoken(id: string): string {
    const card = this.cards.find((c) => c.id === id);
    return card ? optionLabel(card) : id;
  }

  protected slotAria(i: number): string {
    const id = this.placed[i];
    if (id === null) return `Lugar ${i + 1}, vacío`;
    if (this.locked[i]) return `Lugar ${i + 1}: ${this.spoken(id)}`;
    return `${this.spoken(id)} en el lugar ${i + 1}. Toca para sacarla; flechas para moverla.`;
  }

  protected correctLabels(): string {
    return (this.correct ?? []).map((id) => this.labelOf(id)).join(', ');
  }

  // ---- Tocar ----------------------------------------------------------------------------------

  onPoolClick(id: string): void {
    if (this.consumeSuppressedClick() || this.disabled) return;
    const free = this.placed.findIndex((p, i) => p === null && !this.locked[i]);
    if (free < 0) return;
    this.placed[free] = id;
    this.say(`Pusiste ${this.spoken(id)} en el lugar ${free + 1}.`);
    // El botón tocado se fue del montón: el foco pasa a la siguiente tarjeta (o a "Listo").
    this.focusAfter(() => this.firstPoolButton() ?? this.readyButton());
  }

  onSlotClick(i: number): void {
    if (this.consumeSuppressedClick() || this.disabled || this.locked[i]) return;
    const id = this.placed[i];
    if (id === null) return;
    this.placed[i] = null;
    this.say(`Sacaste ${this.spoken(id)}.`);
    // El foco sigue a la tarjeta, que volvió al montón.
    this.focusAfter(() => this.poolButton(id));
  }

  private firstPoolButton(): HTMLElement | null {
    return this.host.nativeElement.querySelector('[data-pool] button') as HTMLElement | null;
  }

  private readyButton(): HTMLElement | null {
    return this.host.nativeElement.querySelector('.ready') as HTMLElement | null;
  }

  private poolButton(id: string): HTMLElement | null {
    return this.host.nativeElement.querySelector(`[data-testid="pool-${id}"]`) as HTMLElement | null;
  }

  /** Después del próximo dibujo (antes, el botón todavía no está en su nuevo sitio). */
  private focusAfter(find: () => HTMLElement | null): void {
    afterNextRender(() => find()?.focus(), { injector: this.injector });
  }

  // ---- Teclado --------------------------------------------------------------------------------

  onSlotKey(event: KeyboardEvent, i: number): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    this.move(i, event.key === 'ArrowLeft' ? -1 : 1);
  }

  /** Mueve la tarjeta del lugar `i` un lugar a la izquierda (-1) o a la derecha (+1). */
  move(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (this.disabled || j < 0 || j >= this.placed.length || this.locked[i] || this.locked[j]) return;
    const id = this.placed[i];
    if (id === null) return;
    [this.placed[i], this.placed[j]] = [this.placed[j], this.placed[i]];
    this.say(`Moviste ${this.spoken(id)} al lugar ${j + 1}.`);
    // El foco sigue a la tarjeta movida.
    this.focusAfter(
      () => this.host.nativeElement.querySelector(`[data-slot-card="${j}"]`) as HTMLElement | null,
    );
  }

  // ---- Arrastrar (alternativa) ------------------------------------------------------------------

  startDrag(event: PointerEvent, id: string): void {
    if (this.disabled || event.button > 0) return;
    const el = event.currentTarget as HTMLElement;
    this.drag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, el, moved: false };
    el.setPointerCapture?.(event.pointerId);
  }

  moveDrag(event: PointerEvent): void {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.el.classList.add('dragging');
    d.el.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  endDrag(event: PointerEvent): void {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    this.resetDragStyle();
    this.drag = null;
    if (!d.moved) return; // fue un toque: lo maneja el click
    this.suppressClick = true;
    // Si el navegador no manda el "click" tras soltar (p. ej. la tarjeta cambió de lugar en la
    // pantalla), la bandera no debe quedar puesta y comerse el próximo toque legítimo.
    setTimeout(() => (this.suppressClick = false));
    const target = this.targetAt(event.clientX, event.clientY, d.el);
    if (target === null) {
      // Soltada fuera de los lugares: vuelve al montón si estaba puesta.
      const from = this.placed.indexOf(d.id);
      if (from >= 0 && !this.locked[from]) {
        this.placed[from] = null;
        this.say(`Sacaste ${this.spoken(d.id)}.`);
      }
    } else {
      this.dropOn(d.id, target);
    }
    this.cdr.markForCheck();
  }

  cancelDrag(): void {
    this.resetDragStyle();
    this.drag = null;
  }

  /** Pone `id` en el lugar `slot` (desde el montón o desde otro lugar, intercambiando). */
  dropOn(id: string, slot: number): void {
    if (this.disabled || slot < 0 || slot >= this.placed.length || this.locked[slot]) return;
    const from = this.placed.indexOf(id);
    if (from === slot) return;
    if (from >= 0) {
      if (this.locked[from]) return;
      [this.placed[from], this.placed[slot]] = [this.placed[slot], this.placed[from]];
    } else {
      this.placed[slot] = id; // si había otra tarjeta, vuelve al montón
    }
    this.say(`Pusiste ${this.spoken(id)} en el lugar ${slot + 1}.`);
  }

  send(): void {
    if (this.disabled || !this.complete()) return;
    this.ready.emit(this.placed.filter((id): id is string => id !== null));
  }

  /**
   * Lugar bajo el punto donde se soltó. Se miran TODAS las capas (`elementsFromPoint`): la de arriba
   * es la misma tarjeta arrastrada, que va encima del lugar.
   */
  private targetAt(x: number, y: number, dragged: HTMLElement): number | null {
    const stack = (document.elementsFromPoint?.(x, y) ?? []) as HTMLElement[];
    for (const el of stack) {
      if (el === dragged || dragged.contains(el)) continue;
      const slot = el.closest('[data-slot]');
      if (slot && this.host.nativeElement.contains(slot)) return Number(slot.getAttribute('data-slot'));
    }
    return null;
  }

  private resetDragStyle(): void {
    if (!this.drag) return;
    this.drag.el.classList.remove('dragging');
    this.drag.el.style.transform = '';
  }

  private consumeSuppressedClick(): boolean {
    if (!this.suppressClick) return false;
    this.suppressClick = false;
    return true;
  }

  private say(message: string): void {
    this.announcement = message;
    this.cdr.markForCheck();
  }
}
