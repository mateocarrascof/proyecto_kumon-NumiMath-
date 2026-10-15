import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { MascotState } from './mascot.port';

/** Mascota provisional "Numi" (SVG + CSS). No es arte definitivo. */
@Component({
  selector: 'app-mascot',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 200 200"
      role="img"
      [attr.aria-label]="'Numi, la mascota, está ' + label"
      [class]="'mascot ' + state"
    >
      <g class="body">
        <ellipse cx="100" cy="186" rx="48" ry="8" class="shadow" />
        <circle cx="100" cy="104" r="68" class="skin" />
        <circle cx="70" cy="124" r="10" class="cheek" />
        <circle cx="130" cy="124" r="10" class="cheek" />
        <g class="eyes">
          <ellipse cx="78" cy="96" rx="9" ry="12" class="eye" />
          <ellipse cx="122" cy="96" rx="9" ry="12" class="eye" />
        </g>
        @switch (state) {
          @case ('happy') {
            <path d="M74 124 Q100 156 126 124 Z" class="mouth-open" />
          }
          @case ('sad') {
            <path d="M82 140 Q100 124 118 140" class="mouth-line" />
          }
          @case ('talking') {
            <ellipse cx="100" cy="134" rx="14" ry="10" class="mouth-open talk" />
          }
          @case ('thinking') {
            <path d="M88 136 H112" class="mouth-line" />
            <text x="150" y="52" class="bubble">?</text>
          }
          @default {
            <path d="M82 128 Q100 144 118 128" class="mouth-line" />
          }
        }
        <text x="44" y="52" class="plus">+</text>
      </g>
    </svg>
  `,
  styles: [
    `
      :host { display: block; width: 100%; max-width: 220px; margin: 0 auto; }
      svg { width: 100%; height: auto; overflow: visible; }
      .skin { fill: #ffd166; stroke: #e0a100; stroke-width: 4; }
      .cheek { fill: #ff9f9f; opacity: 0.7; }
      .eye { fill: #2b2d42; }
      .shadow { fill: rgba(0, 0, 0, 0.12); }
      .mouth-line { fill: none; stroke: #2b2d42; stroke-width: 6; stroke-linecap: round; }
      .mouth-open { fill: #8d2b3a; stroke: #2b2d42; stroke-width: 4; stroke-linejoin: round; }
      .bubble, .plus { font: 700 34px sans-serif; fill: #4361ee; }
      .plus { opacity: 0.5; }
      .body { transform-origin: 100px 180px; transform-box: fill-box; }
      .idle .body { animation: bob 2.6s ease-in-out infinite; }
      .thinking .body { animation: tilt 2s ease-in-out infinite; }
      .happy .body { animation: hop 0.7s ease-in-out infinite; }
      .sad .body { transform: scaleY(0.94); }
      .sad .eyes { transform: translateY(6px); }
      .talking .talk { animation: talk 0.35s ease-in-out infinite alternate; transform-origin: 100px 134px; }
      @keyframes bob { 50% { transform: translateY(-6px); } }
      @keyframes tilt { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
      @keyframes hop { 50% { transform: translateY(-16px); } }
      @keyframes talk { to { transform: scaleY(0.4); } }
      @media (prefers-reduced-motion: reduce) {
        .body, .talk { animation: none !important; }
      }
    `,
  ],
})
export class MascotComponent {
  @Input() state: MascotState = 'idle';

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
