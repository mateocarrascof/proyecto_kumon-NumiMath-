import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  Output,
  afterNextRender,
  inject,
} from '@angular/core';

/**
 * "Mete en la bolsa y cuenta" (pon-en-bolsa-1): los objetos aparecen sueltos y el niño toca cada
 * uno para meterlo en la bolsa (correspondencia uno a uno). Tocar uno dentro de la bolsa lo saca.
 * Cuando están todos dentro, avisa (`allIn`) y la página habilita las opciones. No corrige nada:
 * la respuesta sigue siendo elegir cuántos hay.
 *
 * Accesibilidad: cada objeto es un botón ("pelota, toca para meterla en la bolsa"), con teclado
 * (Tab y Enter o Espacio); el foco pasa al siguiente objeto suelto; una región viva dice "3 en la
 * bolsa". Sin animación de movimiento (el objeto cambia de lugar al instante); el leve "aparecer"
 * se quita con "reducir movimiento".
 */
@Component({
  selector: 'app-bag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (looseCount > 0) {
      <ul class="loose" [attr.aria-label]="'Sueltas: ' + looseCount" data-testid="bag-loose">
        @for (i of indexes; track i) {
          @if (!inBag[i]) {
            <li>
              <button type="button" class="item" [attr.aria-label]="putLabel" (click)="put(i)" [attr.data-testid]="'bag-put-' + i">
                <span aria-hidden="true">{{ glyph }}</span>
              </button>
            </li>
          }
        }
      </ul>
    }
    <div class="bag" data-testid="bag">
      <span class="bag-name" aria-hidden="true">Bolsa</span>
      <ul class="inside" aria-label="Bolsa">
        @for (i of indexes; track i) {
          @if (inBag[i]) {
            <li>
              <button type="button" class="item in" [attr.aria-label]="takeLabel" (click)="take(i)" [attr.data-testid]="'bag-take-' + i">
                <span aria-hidden="true">{{ glyph }}</span>
              </button>
            </li>
          }
        }
      </ul>
    </div>
    @if (looseCount > 0) {
      <p class="hint" data-testid="bag-hint">{{ hint }}</p>
    }
    <p class="sr-only" role="status" aria-live="polite" data-testid="bag-status">{{ status }}</p>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 480px;
        margin: 0 auto 8px;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
      }
      .item {
        width: 44px; /* objetivo táctil */
        height: 44px;
        border-radius: 12px;
        border: 2px solid #4a5568;
        background: #ffffff;
        font-size: 1.6rem;
        line-height: 1;
        padding: 0;
        cursor: pointer;
      }
      .item:focus-visible {
        outline: 4px solid #1a56db;
        outline-offset: 2px;
      }
      .item.in {
        animation: pop 0.15s ease-out;
      }
      @keyframes pop {
        from {
          transform: scale(0.8);
        }
        to {
          transform: scale(1);
        }
      }
      .loose {
        margin-bottom: 8px;
      }
      /* La bolsa: caja con asa, dibujada con bordes (sin imágenes). */
      .bag {
        position: relative;
        min-height: 60px;
        margin-top: 14px;
        padding: 16px 8px 8px;
        border: 3px solid #8a5a2b;
        border-radius: 8px 8px 24px 24px;
        background: #fdf3e7;
      }
      .bag::before {
        content: '';
        position: absolute;
        top: -14px;
        left: 50%;
        width: 48px;
        height: 22px;
        margin-left: -24px;
        border: 3px solid #8a5a2b;
        border-bottom: none;
        border-radius: 24px 24px 0 0;
      }
      .bag-name {
        position: absolute;
        top: 2px;
        left: 10px;
        font-size: 0.8rem;
        font-weight: 700;
        color: #5c3b1a;
      }
      .hint {
        margin: 6px 0 0;
        text-align: center;
        font-size: 0.95rem;
      }
      @media (prefers-reduced-motion: reduce) {
        .item.in {
          animation: none;
        }
      }
    `,
  ],
})
export class BagComponent {
  @Input({ required: true }) glyph = '';
  /** Nombre en singular y si es femenino ("pelota", true): para "meterla" o "meterlo". */
  @Input({ required: true }) name = '';
  @Input() feminine = true;
  @Input({ required: true }) set count(value: number) {
    this.indexes = Array.from({ length: Math.max(0, value) }, (_, i) => i);
    this.inBag = this.indexes.map(() => false);
  }
  /** Con todos los objetos dentro (true) o con alguno afuera otra vez (false). */
  @Output() readonly allIn = new EventEmitter<boolean>();

  protected indexes: number[] = [];
  protected inBag: boolean[] = [];

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly cdr = inject(ChangeDetectorRef);

  protected get looseCount(): number {
    return this.inBag.filter((x) => !x).length;
  }

  protected get status(): string {
    const n = this.inBag.filter(Boolean).length;
    return n ? `${n} en la bolsa` : '';
  }

  /** "Cuando estén todas en la bolsa, elige cuántas hay." (concuerda con el objeto). */
  protected get hint(): string {
    const all = this.feminine ? 'todas' : 'todos';
    return `Cuando estén ${all} en la bolsa, elige ${this.feminine ? 'cuántas' : 'cuántos'} hay.`;
  }

  protected get putLabel(): string {
    return `${this.name}, toca para ${this.feminine ? 'meterla' : 'meterlo'} en la bolsa`;
  }

  protected get takeLabel(): string {
    return `${this.name} en la bolsa, toca para ${this.feminine ? 'sacarla' : 'sacarlo'}`;
  }

  put(i: number): void {
    if (this.inBag[i]) return;
    this.inBag = this.inBag.map((x, j) => (j === i ? true : x));
    if (this.looseCount === 0) this.allIn.emit(true);
    // El foco sigue al próximo objeto suelto (o, sin sueltos, se queda en la bolsa).
    this.focusAfterRender(() => this.next('bag-put-', i) ?? this.next('bag-take-', i));
  }

  take(i: number): void {
    if (!this.inBag[i]) return;
    const wasFull = this.looseCount === 0;
    this.inBag = this.inBag.map((x, j) => (j === i ? false : x));
    if (wasFull) this.allIn.emit(false);
    this.focusAfterRender(() => this.next('bag-take-', i) ?? this.next('bag-put-', i));
  }

  /** El botón con ese prefijo más cercano a `i` (primero hacia adelante). */
  private next(prefix: string, i: number): HTMLElement | null {
    const buttons = [...this.host.nativeElement.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)];
    const index = (b: HTMLElement) => Number(b.dataset['testid']?.slice(prefix.length));
    return buttons.find((b) => index(b) > i) ?? buttons.at(-1) ?? null;
  }

  private focusAfterRender(pick: () => HTMLElement | null): void {
    this.cdr.markForCheck();
    afterNextRender(() => pick()?.focus(), { injector: this.injector });
  }
}
