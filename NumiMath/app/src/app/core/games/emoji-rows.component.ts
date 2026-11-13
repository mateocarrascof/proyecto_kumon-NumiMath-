import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Emoji por fila: como contar de 5 en 5 (igual que en el pictograma). */
export const EMOJI_PER_ROW = 5;

/** Separa un texto en emoji (grafemas), para no partir un emoji compuesto. */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  return Array.from(text);
}

/**
 * Bloque de emoji para contar (práctica y juegos): todos juntos, en filas parejas de 5 con la
 * última fila alineada a la izquierda, ANTES de la pregunta (nunca un emoji suelto en la línea del
 * texto). Varios grupos (`glyphs` separados por espacios, como en "Junta y cuenta"): cada uno en
 * su recuadro.
 *
 * El lector de pantalla oye solo la etiqueta ("9 pelotas"), no cada emoji: el bloque es una
 * imagen (`role="img"`). Cabe en 360 px con 20 emoji (4 filas de 5).
 */
@Component({
  selector: 'app-emoji-rows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="emoji-block" role="img" [attr.aria-label]="label" data-testid="emoji-block">
      @for (group of groups; track $index) {
        <div
          class="group"
          [class.boxed]="groups.length > 1"
          [style.grid-template-columns]="'repeat(' + columns(group) + ', var(--emoji-cell))'"
          data-testid="glyph-group"
        >
          @for (cell of group; track $index) {
            <span class="cell">{{ cell }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        --emoji-cell: 2.1rem;
      }
      .emoji-block {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin: 4px auto 8px;
        max-width: 100%;
      }
      .group {
        display: grid;
        justify-content: start; /* la última fila, a la izquierda */
        row-gap: 2px;
        font-size: 1.7rem;
        line-height: var(--emoji-cell);
      }
      .group.boxed {
        border: 3px dashed #4a5568;
        border-radius: 14px;
        padding: 2px 6px;
      }
      .cell {
        width: var(--emoji-cell);
        text-align: center;
      }
    `,
  ],
})
export class EmojiRowsComponent {
  /** Grupos de emoji (cada uno en filas de 5). */
  protected groups: string[][] = [];

  /** Emoji de los grupos, separados por espacios ("🌸🌸🌸 🌸🌸"). */
  @Input({ required: true }) set glyphs(value: string) {
    this.groups = value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((g) => graphemes(g));
  }

  /** Lo que oye el lector de pantalla ("9 pelotas" o "3 flores y 2 flores"). */
  @Input({ required: true }) label = '';

  protected columns(group: string[]): number {
    return Math.min(EMOJI_PER_ROW, Math.max(1, group.length));
  }
}
