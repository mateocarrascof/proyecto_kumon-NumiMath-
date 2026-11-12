import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  ViewChild,
} from '@angular/core';

import { GRID_SIZE, SHEET_HEIGHT, SHEET_WIDTH } from '../core/scratchpad/scratchpad.component';
import { SheetStroke } from '../core/sheets/sheets.port';

/**
 * Dibuja una hoja guardada (solo lectura) sobre la misma cuadrícula del papel: la cuadrícula es el
 * fondo y los trazos van en un canvas transparente, así la goma solo borra tinta, como en el papel.
 */
@Component({
  selector: 'app-sheet-view',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="sheet" [style.backgroundSize]="gridSize">
    <canvas #canvas width="1200" height="900" role="img" [attr.aria-label]="label"></canvas>
  </div>`,
  styles: [
    `
      .sheet {
        max-width: 100%;
        aspect-ratio: 4 / 3;
        background-color: #fffdf6;
        background-image:
          linear-gradient(to right, #cfe3f5 1px, transparent 1px),
          linear-gradient(to bottom, #cfe3f5 1px, transparent 1px);
        border: 1px solid #c9c5d8;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class SheetViewComponent implements OnChanges {
  @Input() strokes: SheetStroke[] = [];
  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;

  /** La cuadrícula escala con el ancho de la hoja: 24 de 1200 unidades. */
  protected readonly gridSize = `${(GRID_SIZE / SHEET_WIDTH) * 100}% ${(GRID_SIZE / SHEET_HEIGHT) * 100}%`;
  protected get label(): string {
    return `Hoja de cálculo con ${this.strokes.length} trazos`;
  }

  /**
   * El tamaño del canvas (1200 x 900 = SHEET_WIDTH x SHEET_HEIGHT) va como ATRIBUTO ESTÁTICO de la
   * plantilla, no como enlace: Angular llama a este `ngOnChanges` antes de actualizar los enlaces del
   * hijo, y cambiar el tamaño de un canvas lo borra (la hoja salía vacía). Lo cubre la prueba de orden.
   */
  ngOnChanges(): void {
    this.paint();
  }

  private paint(): void {
    const ctx = this.canvasRef?.nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
    for (const stroke of this.strokes) {
      const [first, ...rest] = stroke.points;
      if (!first) continue;
      ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(first[0], first[1]);
      if (rest.length) for (const [x, y] of rest) ctx.lineTo(x, y);
      else ctx.lineTo(first[0] + 0.01, first[1]);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
