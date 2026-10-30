import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
} from '@angular/core';

interface Piece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  color: string;
  round: boolean;
}

const COLORS = ['#0f7c70', '#c24e3f', '#6e4bd8', '#ffd166', '#2ec4b6', '#ff8fab'];
const LIFETIME_MS = 2200;

/**
 * Lluvia de confeti decorativa. Cada vez que `burst` aumenta, lanza `pieces` papelitos.
 * Solo CSS (transform/opacity). No se muestra si el sistema pide reducir el movimiento.
 */
@Component({
  selector: 'app-confetti',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of pieces(); track p.id) {
      <i
        [class.round]="p.round"
        [style.left.%]="p.left"
        [style.background]="p.color"
        [style.animation-delay.ms]="p.delay"
        [style.animation-duration.ms]="p.duration"
        [style.--drift.px]="p.drift"
        [style.--spin.deg]="p.spin"
      ></i>
    }
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
        z-index: 1000;
      }
      i {
        position: absolute;
        top: -16px;
        width: 10px;
        height: 16px;
        border-radius: 3px;
        opacity: 0;
        animation-name: fall;
        animation-timing-function: cubic-bezier(0.25, 0.6, 0.5, 1);
        animation-fill-mode: forwards;
      }
      i.round {
        width: 12px;
        height: 12px;
        border-radius: 50%;
      }
      @keyframes fall {
        0% { opacity: 1; transform: translate(0, 0) rotate(0); }
        85% { opacity: 1; }
        100% { opacity: 0; transform: translate(var(--drift), 105vh) rotate(var(--spin)); }
      }
    `,
  ],
  host: { 'aria-hidden': 'true' },
})
export class ConfettiComponent implements OnChanges, OnDestroy {
  /** Contador: cada aumento dispara una lluvia. */
  @Input() burst = 0;
  /** Cantidad de papelitos por lluvia. */
  @Input() count = 40;

  protected readonly pieces = signal<Piece[]>([]);
  private nextId = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['burst'];
    if (!change || change.firstChange || this.burst <= (change.previousValue ?? 0)) return;
    if (prefersReducedMotion()) return;
    this.launch();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private launch(): void {
    const fresh: Piece[] = Array.from({ length: this.count }, () => ({
      id: this.nextId++,
      left: Math.random() * 100,
      delay: Math.random() * 300,
      duration: 1200 + Math.random() * 700,
      drift: (Math.random() - 0.5) * 160,
      spin: (Math.random() - 0.5) * 1080,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() < 0.3,
    }));
    this.pieces.set(fresh);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pieces.set([]), LIFETIME_MS);
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
