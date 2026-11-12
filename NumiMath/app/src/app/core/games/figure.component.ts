import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Colores de las figuras (por id del servidor). El color es un apoyo: la forma siempre distingue. */
const FIGURE_COLORS: Record<string, string> = {
  rojo: '#e53e3e',
  azul: '#3182ce',
  verde: '#38a169',
  amarillo: '#ecc94b',
  morado: '#805ad5',
};
const UNKNOWN_COLOR = '#cbd5e0';

/**
 * Figura SVG propia (CU-A21, parte 3), dibujada por el proyecto: círculo, cuadrado, triángulo,
 * rectángulo, cubo, esfera y cilindro. Recibe el id del servidor (`f:cubo-rojo`).
 *
 * Todas llevan borde oscuro grueso, así se distinguen por la FORMA aunque no se vea el color. El
 * SVG es decorativo (`aria-hidden`): quien la usa pone la etiqueta accesible ("cubo rojo").
 */
@Component({
  selector: 'app-figure',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 60 60" aria-hidden="true" focusable="false" [attr.data-shape]="shape">
      <g [attr.fill]="fill" stroke="#1a202c" stroke-width="3" stroke-linejoin="round">
        @switch (shape) {
          @case ('circulo') {
            <circle cx="30" cy="30" r="24" />
          }
          @case ('cuadrado') {
            <rect x="8" y="8" width="44" height="44" />
          }
          @case ('triangulo') {
            <polygon points="30,6 56,52 4,52" />
          }
          @case ('rectangulo') {
            <rect x="2" y="17" width="56" height="26" />
          }
          @case ('cubo') {
            <!-- Cara de frente, tapa (más clara) y costado (más oscuro). -->
            <rect x="5" y="21" width="34" height="34" />
            <polygon points="5,21 21,6 55,6 39,21" />
            <polygon points="5,21 21,6 55,6 39,21" fill="#ffffff" fill-opacity="0.4" />
            <polygon points="39,21 55,6 55,40 39,55" />
            <polygon points="39,21 55,6 55,40 39,55" fill="#000000" fill-opacity="0.2" />
          }
          @case ('esfera') {
            <!-- Ecuador punteado y brillo: lo que la distingue del círculo. -->
            <circle cx="30" cy="30" r="25" />
            <ellipse cx="30" cy="30" rx="25" ry="8" fill="none" stroke-width="2" stroke-dasharray="4 3" />
            <ellipse cx="21" cy="19" rx="6" ry="4" fill="#ffffff" fill-opacity="0.7" stroke="none" />
          }
          @case ('cilindro') {
            <path d="M12 12 V48 A18 6 0 0 0 48 48 V12" />
            <ellipse cx="30" cy="12" rx="18" ry="6" />
            <ellipse cx="30" cy="12" rx="18" ry="6" fill="#ffffff" fill-opacity="0.4" />
          }
          @default {
            <rect x="8" y="8" width="44" height="44" rx="12" stroke-dasharray="5 4" />
          }
        }
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        width: 56px;
        height: 56px;
      }
      svg {
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ],
})
export class FigureComponent {
  /** Id del servidor: `f:<forma>-<color>`. */
  @Input({ required: true }) figureId = '';

  protected get shape(): string {
    return this.parts[0];
  }

  protected get fill(): string {
    return FIGURE_COLORS[this.parts[1]] ?? UNKNOWN_COLOR;
  }

  private get parts(): [string, string] {
    const [shape = '', color = ''] = (this.figureId.split(':')[1] ?? '').split('-');
    return [shape, color];
  }
}
