import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { FigureComponent } from './figure.component';
import { GAME_TEXT } from './games.messages';
import { GameExercise } from './games.port';

/** Ancho de una unidad de medida (clip o paso), en px. Lo medido tiene `length` unidades de ancho. */
export const MEASURE_UNIT_PX = 34;

/**
 * Lo que se dibuja encima de las opciones (CU-A21, parte 3), si el ejercicio lo trae:
 * - `pattern`: fila de figuras y un "?" al final (patrones).
 * - `picto`: pictograma como tabla, con la cantidad de cada fila para el lector de pantalla.
 * - `measure`: un lápiz, una cinta o una alfombra, con clips o pasos en fila debajo, del mismo largo.
 *
 * Es parte de la pregunta (se ve en la pantalla). Los emoji y figuras repetidos se ocultan al lector
 * de pantalla y van con un texto equivalente, para no leer cada emoji uno por uno.
 */
@Component({
  selector: 'app-game-visual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FigureComponent],
  template: `
    @if (exercise.pattern?.length) {
      <div class="pattern" role="img" [attr.aria-label]="patternLabel" data-testid="visual-pattern">
        @for (f of exercise.pattern; track $index) {
          <app-figure class="fig" [figureId]="f.id"></app-figure>
        }
        <span class="next" aria-hidden="true">?</span>
      </div>
    } @else if (exercise.picto?.length) {
      <table class="picto" data-testid="visual-picto">
        <caption class="sr-only">{{ text.pictoCaption }}</caption>
        @for (row of exercise.picto; track row.name) {
          <tr>
            <th scope="row">{{ row.name }}</th>
            <td>
              <span class="icons" aria-hidden="true">
                @for (n of fives(row.count); track $index) {
                  <span class="five">{{ repeat(row.glyph, n) }}</span>
                }
              </span>
              <span class="sr-only">{{ exercise.scale ? text.pictoIcons(row.count) : row.count }}</span>
            </td>
          </tr>
        }
      </table>
    } @else if (exercise.figure; as f) {
      <div class="big-figure" role="img" [attr.aria-label]="f.label" data-testid="visual-figure">
        <app-figure class="big" [figureId]="f.id"></app-figure>
      </div>
    } @else if (exercise.clock; as c) {
      <!-- Reloj propio: la manecilla corta es más gruesa y la larga más fina (forma, no color). -->
      <svg class="clock" viewBox="0 0 120 120" role="img" [attr.aria-label]="text.clockLabel(c.hour, c.minute)" data-testid="visual-clock">
        <circle cx="60" cy="60" r="56" fill="#ffffff" stroke="#1a202c" stroke-width="4" />
        @for (h of hours; track h) {
          <text [attr.x]="handX(h * 30, 44)" [attr.y]="handY(h * 30, 44)" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="700" fill="#1a202c">{{ h }}</text>
        }
        <line class="hour-hand" x1="60" y1="60" [attr.x2]="handX(hourAngle(c), 28)" [attr.y2]="handY(hourAngle(c), 28)" stroke="#1a202c" stroke-width="7" stroke-linecap="round" />
        <line class="minute-hand" x1="60" y1="60" [attr.x2]="handX(c.minute * 6, 42)" [attr.y2]="handY(c.minute * 6, 42)" stroke="#1a202c" stroke-width="3" stroke-linecap="round" />
        <circle cx="60" cy="60" r="4" fill="#1a202c" />
      </svg>
    } @else if (exercise.blocks; as b) {
      <!-- Bloques: barras de diez (con sus 10 cuadritos) y cubitos sueltos. La forma los
           distingue (barra larga y cubito), no solo el color. -->
      <div class="blocks" role="img" [attr.aria-label]="text.blocksLabel(b.tens, b.ones)" data-testid="visual-blocks">
        <div class="rods">
          @for (r of units(b.tens); track r) {
            <svg class="rod" viewBox="0 0 14 104" aria-hidden="true" focusable="false">
              @for (i of units(10); track i) {
                <rect x="2" [attr.y]="2 + i * 10" width="10" height="10" fill="#90cdf4" stroke="#1a202c" stroke-width="1.5" />
              }
            </svg>
          }
        </div>
        <div class="cubes">
          @for (c of units(b.ones); track c) {
            <svg class="cube" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
              <rect x="2" y="2" width="10" height="10" fill="#faf089" stroke="#1a202c" stroke-width="1.5" />
            </svg>
          }
        </div>
      </div>
    } @else if (exercise.measure; as m) {
      <figure class="measure" data-testid="visual-measure">
        <svg
          class="thing"
          [attr.width]="m.length * unit"
          height="26"
          [attr.viewBox]="'0 0 ' + m.length * unit + ' 26'"
          aria-hidden="true"
          focusable="false"
          [attr.data-thing]="m.thing"
        >
          @switch (m.thing) {
            @case ('lapiz') {
              <rect x="1" y="4" width="10" height="18" fill="#f687b3" stroke="#1a202c" stroke-width="2" />
              <rect x="11" y="4" [attr.width]="m.length * unit - 30" height="18" fill="#f6c343" stroke="#1a202c" stroke-width="2" />
              <polygon [attr.points]="tip(m.length)" fill="#f3d9a4" stroke="#1a202c" stroke-width="2" stroke-linejoin="round" />
            }
            @case ('cinta') {
              <rect x="1" y="6" [attr.width]="m.length * unit - 2" height="14" rx="3" fill="#ed64a6" stroke="#1a202c" stroke-width="2" />
            }
            @default {
              <rect x="1" y="2" [attr.width]="m.length * unit - 2" height="22" rx="4" fill="#c05621" stroke="#1a202c" stroke-width="2" />
              <rect x="6" y="7" [attr.width]="m.length * unit - 12" height="12" rx="2" fill="none" stroke="#fbd38d" stroke-width="2" />
            }
          }
        </svg>
        <ul class="units" [attr.aria-label]="m.unit === 'paso' ? text.measureSteps : text.measureClips">
          @for (i of units(m.length); track i) {
            <li [style.width.px]="unit">
              <span aria-hidden="true">{{ m.glyph }}</span>
              <span class="sr-only">{{ m.unit }}</span>
            </li>
          }
        </ul>
        <figcaption class="sr-only">{{ text.measureCaption(m.name, m.unit) }}</figcaption>
      </figure>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        margin: 0 auto 16px;
        max-width: 480px;
      }
      .pattern {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 3px; /* 7 figuras y el "?" caben en una línea a 360 px: 8 × 36 + 7 × 3 = 309 px */
      }
      .fig {
        width: 36px;
        height: 36px;
      }
      .next {
        width: 36px;
        height: 36px;
        border: 3px dashed #4a5568;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        font-weight: 700;
      }
      .picto {
        margin: 0 auto;
        border-collapse: collapse;
      }
      .picto th,
      .picto td {
        border: 2px solid #a0aec0;
        padding: 4px 8px;
        text-align: left;
      }
      .picto th {
        font-weight: 700;
      }
      /* Grupos de 5 (como al contar con palitos): si no caben en 360 px, el grupo pasa entero a la
         línea siguiente y ningún emoji se corta. */
      .icons {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 10px;
        font-size: 1.25rem;
      }
      .five {
        white-space: nowrap;
      }
      .big-figure {
        display: flex;
        justify-content: center;
      }
      .big {
        width: 112px;
        height: 112px;
      }
      .clock {
        display: block;
        width: 128px;
        height: 128px;
        margin: 0 auto;
      }
      /* 9 barras y 18 cubitos caben en 360 px: 9 × 18 + 12 + 5 × 17 = 259 px. */
      .blocks {
        display: flex;
        justify-content: center;
        align-items: flex-end;
        gap: 12px;
      }
      .rods {
        display: flex;
        gap: 4px;
      }
      .rod {
        width: 14px;
        height: 104px;
      }
      .cubes {
        display: grid;
        grid-template-columns: repeat(5, 14px);
        gap: 3px;
      }
      .cube {
        width: 14px;
        height: 14px;
      }
      .measure {
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .thing {
        display: block;
        max-width: 100%;
      }
      .units {
        display: flex;
        margin: 4px 0 0;
        padding: 0;
        list-style: none;
      }
      .units li {
        text-align: center;
        font-size: 1.5rem;
        line-height: 1.2;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ],
})
export class GameVisualComponent {
  @Input({ required: true }) exercise!: GameExercise;

  protected readonly text = GAME_TEXT;
  protected readonly unit = MEASURE_UNIT_PX;

  protected get patternLabel(): string {
    return GAME_TEXT.patternRow((this.exercise.pattern ?? []).map((f) => f.label));
  }

  protected readonly hours = Array.from({ length: 12 }, (_, i) => i + 1);

  /** Ángulo de la manecilla corta: avanza media hora entre dos números en "y media". */
  protected hourAngle(c: { hour: number; minute: number }): number {
    return ((c.hour % 12) + c.minute / 60) * 30;
  }

  protected handX(degrees: number, length: number): number {
    return Math.round((60 + length * Math.sin((degrees * Math.PI) / 180)) * 10) / 10;
  }

  protected handY(degrees: number, length: number): number {
    return Math.round((60 - length * Math.cos((degrees * Math.PI) / 180)) * 10) / 10;
  }

  protected repeat(glyph: string, count: number): string {
    return Array.from({ length: count }, () => glyph).join('');
  }

  /** 8 → [5, 3]. */
  protected fives(count: number): number[] {
    return Array.from({ length: Math.ceil(count / 5) }, (_, i) => Math.min(5, count - i * 5));
  }

  protected units(length: number): number[] {
    return Array.from({ length }, (_, i) => i);
  }

  /** Punta del lápiz: un triángulo al final, del alto del lápiz. */
  protected tip(length: number): string {
    const end = length * this.unit - 1;
    return `${end - 19},4 ${end},13 ${end - 19},22`;
  }
}
