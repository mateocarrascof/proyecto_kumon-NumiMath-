import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
} from '@angular/core';

/** "0:42", "1:05", "12:00". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Reloj pequeño y amable para el niño: cuenta HACIA ARRIBA, en gris, sin colores de alerta, sin
 * sonidos ni mensajes. Es solo informativo: el tiempo que ve el tutor lo mide el servidor.
 * Tocarlo lo oculta o lo muestra (se recuerda mientras siga abierta la pantalla).
 * Se reinicia cuando cambia `resetKey` (el ejercicio) y se detiene con `running = false`.
 */
@Component({
  selector: 'app-gentle-timer',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="timer"
      [class.hidden-time]="hidden()"
      [attr.aria-label]="hidden() ? 'Mostrar el reloj' : 'Ocultar el reloj'"
      (click)="toggle()"
      data-testid="gentle-timer"
    >
      <span aria-hidden="true">⏱</span>
      @if (!hidden()) {
        <span class="time" aria-hidden="true">{{ text() }}</span>
      }
    </button>
  `,
  styles: [
    `
      :host { display: inline-block; }
      .timer {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 32px;
        padding: 2px 10px;
        font: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: inherit;
        opacity: 0.75;
        background: rgba(255, 255, 255, 0.18);
        border: 0;
        border-radius: 999px;
        cursor: pointer;
      }
      .timer.hidden-time { opacity: 0.5; }
      .timer:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    `,
  ],
})
export class GentleTimerComponent implements OnChanges, OnDestroy {
  @Input() resetKey: unknown;
  @Input() running = true;

  readonly hidden = signal(false);
  private readonly seconds = signal(0);
  readonly text = () => clock(this.seconds());
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  /** Para pruebas. */
  now: () => number = () => Date.now();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resetKey']) {
      this.startedAt = this.now();
      this.seconds.set(0);
    }
    if (this.running) this.start();
    else this.stop();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  toggle(): void {
    this.hidden.update((h) => !h);
  }

  /** Avanza el reloj (lo llama el intervalo; público para pruebas). */
  tick(): void {
    this.seconds.set(Math.floor((this.now() - this.startedAt) / 1000));
  }

  private start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 1000);
  }

  private stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
