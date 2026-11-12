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
              <span class="sr-only">{{ row.count }}</span>
            </td>
          </tr>
        }
      </table>
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
