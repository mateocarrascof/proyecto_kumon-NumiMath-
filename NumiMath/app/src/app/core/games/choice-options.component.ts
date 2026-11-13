import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { FigureComponent } from './figure.component';
import { GAME_TEXT, objectName, optionLabel } from './games.messages';
import { GameOption, GameScene } from './games.port';

/**
 * Opciones táctiles (CU-A21): de 2 a 4 botones grandes con un número, un emoji o un símbolo (y en la
 * parte 3, figuras SVG propias). El niño toca una.
 *
 * Accesibilidad: botones nativos (teclado gratis) con `aria-pressed` y una etiqueta resumida
 * ("3 manzanas", "mayor que"). Tras corregir, cada estado se dice con un texto y un ícono, no solo
 * con color ("Esta era", "Tu elección"). Animación suave que respeta "reducir movimiento".
 */
@Component({
  selector: 'app-choice-options',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FigureComponent],
  template: `
    <div class="options" [class.scene]="!!scene" [attr.aria-label]="label" role="group">
      @if (scene) {
        <span class="center" aria-hidden="true" data-testid="scene-center">{{ scene.center }}</span>
      }
      @for (o of options; track o.id) {
        <button
          type="button"
          [style.grid-area]="placeOf(o.id)"
          class="option"
          [class.chosen]="chosen === o.id"
          [class.right]="isRight(o.id)"
          [class.wrong]="isWrong(o.id)"
          [attr.data-kind]="o.kind"
          [attr.aria-pressed]="chosen === o.id"
          [attr.aria-label]="ariaFor(o)"
          [disabled]="disabled"
          (click)="choose(o.id)"
          [attr.data-testid]="'option-' + o.id"
        >
          @if (o.kind === 'figure') {
            <app-figure class="value" [figureId]="o.id"></app-figure>
          } @else {
            <span class="value" aria-hidden="true">{{ o.label }}</span>
          }
          @if (isRight(o.id)) {
            <span class="badge" aria-hidden="true">✓ {{ text.correctBadge }}</span>
          } @else if (isWrong(o.id)) {
            <span class="badge" aria-hidden="true">• {{ text.chosenBadge }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: [
    `
      /* Una sola columna para 2, 3 o 4 opciones (y cualquier juego futuro): mismo ancho, misma
         altura (68 px, entre 64 y 72), espacio parejo y contenido centrado. Se muestran en el
         orden mezclado del servidor (la correcta no queda siempre en el mismo lugar). */
      .options {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        width: 100%;
        max-width: 480px;
        margin: 0 auto;
      }
      .option {
        height: 68px; /* objetivo táctil grande para dedos pequeños */
        padding: 4px 12px;
        border-radius: 18px;
        border: 3px solid #4a5568;
        background: #ffffff;
        color: #1a202c;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font: inherit;
        cursor: pointer;
        transition: transform 0.15s ease;
      }
      .option:active:not(:disabled) {
        transform: scale(0.97);
      }
      .option:focus-visible {
        outline: 4px solid #1a56db;
        outline-offset: 3px;
      }
      .value {
        font-size: 1.8rem;
        font-weight: 700;
        line-height: 1.1;
        overflow-wrap: anywhere;
      }
      /* Escena en cruz (orientación): la caja al centro y un objeto en cada lado. */
      .options.scene {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        grid-template-areas:
          '. arriba .'
          'izquierda centro derecha'
          '. abajo .';
        gap: 8px;
      }
      .center {
        grid-area: centro;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 3rem;
      }
      app-figure.value {
        width: 52px;
        height: 52px;
      }
      .option[data-kind='emoji'] .value {
        font-size: 1.4rem;
        letter-spacing: 2px;
      }
      .chosen {
        border-width: 5px;
        border-color: #1a56db;
      }
      /* Correcta: borde grueso + ícono y texto (no solo el color). */
      .right {
        border: 5px solid #1e7a3a;
        background: #e6f6ea;
      }
      /* Elegida y no era: borde punteado + texto (no "mal", sin rojo de alarma). */
      .wrong {
        border: 5px dashed #8a4b00;
        background: #fff4e5;
      }
      .badge {
        font-size: 0.95rem;
        font-weight: 700;
      }
      .option:disabled {
        cursor: default;
        opacity: 1;
      }
      @media (prefers-reduced-motion: reduce) {
        .option {
          transition: none;
        }
        .option:active:not(:disabled) {
          transform: none;
        }
      }
    `,
  ],
})
export class ChoiceOptionsComponent {
  @Input({ required: true }) options: GameOption[] = [];
  /** Nombre del grupo para el lector de pantalla (p. ej. el enunciado). */
  @Input() label = 'Opciones';
  @Input() disabled = false;
  /** Id tocado por el niño. */
  @Input() chosen: string | null = null;
  /** Después de corregir: ids correctos (antes, null). */
  @Input() correct: string[] | null = null;
  /** Orientación (parte 3): cada opción va en su lugar de la cruz y su etiqueta dice dónde está. */
  @Input() scene: GameScene | null = null;
  @Output() readonly pick = new EventEmitter<string>();

  protected readonly text = GAME_TEXT;

  protected isRight(id: string): boolean {
    return this.correct !== null && this.correct.includes(id);
  }

  protected isWrong(id: string): boolean {
    return this.correct !== null && this.chosen === id && !this.correct.includes(id);
  }

  protected placeOf(id: string): string | null {
    return this.scene?.places.find((p) => p.id === id)?.position ?? null;
  }

  protected ariaFor(option: GameOption): string {
    const place = this.placeOf(option.id);
    const base = place
      ? `${objectName(option)}, ${GAME_TEXT.scenePlace[place] ?? place}`
      : optionLabel(option);
    if (this.isRight(option.id)) return `${base}. ${GAME_TEXT.correctBadge}`;
    if (this.isWrong(option.id)) return `${base}. ${GAME_TEXT.chosenBadge}`;
    return base;
  }

  protected choose(id: string): void {
    if (this.disabled) return;
    this.pick.emit(id);
  }
}
