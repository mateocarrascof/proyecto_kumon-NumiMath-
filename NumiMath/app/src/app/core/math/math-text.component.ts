import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type MathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'fraction'; num: string; den: string };

const FRACTION = /(\d+)\/(\d+)/g;

/** Separa un enunciado en texto y fracciones "a/b" (para mostrarlas apiladas). */
export function mathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(FRACTION)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ kind: 'text', value: text.slice(last, at) });
    segments.push({ kind: 'fraction', num: match[1], den: match[2] });
    last = at + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });
  return segments;
}

/**
 * Muestra un enunciado con las fracciones apiladas (numerador sobre denominador), como en el
 * cuaderno. Solo CSS: sin librerías. Los lectores de pantalla leen "3 quintos" como "3 de 5".
 */
@Component({
  selector: 'app-math-text',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (s of segments; track $index) {
      @if (s.kind === 'text') {
        <span>{{ s.value }}</span>
      } @else {
        <span class="frac" role="img" [attr.aria-label]="s.num + ' de ' + s.den">
          <span class="num" aria-hidden="true">{{ s.num }}</span>
          <span class="den" aria-hidden="true">{{ s.den }}</span>
        </span>
      }
    }
  `,
  styles: `
    .frac {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      vertical-align: middle;
      margin: 0 0.15em;
      line-height: 1.05;
      font-size: 0.85em;
    }
    .num {
      padding: 0 0.2em;
      border-bottom: 0.12em solid currentColor;
    }
    .den {
      padding: 0 0.2em;
    }
  `,
})
export class MathTextComponent {
  segments: MathSegment[] = [];

  @Input({ required: true }) set text(value: string) {
    this.segments = mathSegments(value ?? '');
  }
}
