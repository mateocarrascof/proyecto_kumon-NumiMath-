import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';

import { MascotState } from './mascot.port';

/** Mascota provisional "Numi" (SVG + CSS). No es arte definitivo. */
@Component({
  selector: 'app-mascot',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['mascot.component.scss'],
  template: `
    @if (message) {
      <!-- Texto normal (sin aria-hidden): el lector de pantalla puede leer lo que dice Numi. No es
           aria-live: los avisos importantes ya los anuncia cada pantalla, sin lecturas dobles. -->
      <p class="bubble" [class.alt]="flip">{{ message }}</p>
    }
    <svg
      viewBox="0 0 200 210"
      role="img"
      [attr.aria-label]="'Numi, la mascota, está ' + label"
      [class]="'mascot ' + state"
    >
      <ellipse cx="100" cy="200" rx="48" ry="7" class="shadow" />
      <g class="body">
        <g class="antenna">
          <path d="M100 42 Q104 26 100 14" class="antenna-line" />
          <path
            d="M100 0 l3.5 7.5 8 1 -6 5.5 1.5 8 -7 -4 -7 4 1.5 -8 -6 -5.5 8 -1z"
            class="star"
          />
        </g>
        <g class="arm arm-left"><path d="M42 128 Q22 120 16 100" class="limb" /></g>
        <g class="arm arm-right"><path d="M158 128 Q178 120 184 100" class="limb" /></g>
        <circle cx="100" cy="112" r="68" class="skin" />
        <circle cx="70" cy="132" r="10" class="cheek" />
        <circle cx="130" cy="132" r="10" class="cheek" />
        <g class="eyes">
          <g class="blink">
            <ellipse cx="78" cy="104" rx="9" ry="12" class="eye" />
            <ellipse cx="122" cy="104" rx="9" ry="12" class="eye" />
            <circle cx="81" cy="99" r="3.2" class="shine" />
            <circle cx="125" cy="99" r="3.2" class="shine" />
          </g>
        </g>
        @switch (state) {
          @case ('happy') {
            <path d="M74 132 Q100 164 126 132 Z" class="mouth-open" />
          }
          @case ('sad') {
            <path d="M82 148 Q100 132 118 148" class="mouth-line" />
          }
          @case ('talking') {
            <ellipse cx="100" cy="142" rx="14" ry="10" class="mouth-open talk" />
          }
          @case ('thinking') {
            <path d="M88 144 H112" class="mouth-line" />
            <text x="150" y="58" class="sign">?</text>
          }
          @default {
            <path d="M82 136 Q100 152 118 136" class="mouth-line" />
          }
        }
        <text x="30" y="58" class="sign plus">+</text>
      </g>
    </svg>
  `,
})
export class MascotComponent implements OnChanges {
  @Input() state: MascotState = 'idle';
  /** Frase corta y fija para el globo de diálogo (ver mascot-phrases.ts). */
  @Input() message = '';
  /** Alterna entre dos animaciones iguales para repetir el "pop" cuando cambia la frase. */
  protected flip = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['message'] && !changes['message'].firstChange) this.flip = !this.flip;
  }

  get label(): string {
    const names: Record<MascotState, string> = {
      idle: 'tranquila',
      thinking: 'pensando',
      happy: 'contenta',
      sad: 'un poco triste',
      talking: 'hablando',
    };
    return names[this.state];
  }
}
