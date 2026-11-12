import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  inject,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

import { SheetStroke } from '../sheets/sheets.port';

export interface PenColor {
  name: string;
  value: string;
}

export const PEN_COLORS: readonly PenColor[] = [
  { name: 'negro', value: '#2b2d42' },
  { name: 'azul', value: '#1d4ed8' },
  { name: 'rojo', value: '#c0392b' },
];

/** Topes de la API para una hoja guardada (api/app/routes/sheets.py). */
export const SHEET_MAX_STROKES = 600;
export const SHEET_MAX_STROKE_POINTS = 3000;
export const SHEET_MAX_POINTS = 12000;

/** Separación mínima entre puntos guardados, en unidades de la hoja; se prueba de menor a mayor. */
const SIMPLIFY_STEPS = [2, 4, 8] as const;

/**
 * Ajusta los puntos al rango de la hoja y descarta los que están a menos de `step` del último
 * conservado. Siempre deja el primero y el último (un punto suelto sigue siendo un punto).
 */
function simplifyPoints(points: Point[], step: number): [number, number][] {
  const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max);
  const all = points.map((p): [number, number] => [clamp(p.x, SHEET_WIDTH), clamp(p.y, SHEET_HEIGHT)]);
  const kept: [number, number][] = [all[0]];
  for (let i = 1; i < all.length - 1; i++) {
    const last = kept[kept.length - 1];
    if (Math.hypot(all[i][0] - last[0], all[i][1] - last[1]) >= step) kept.push(all[i]);
  }
  if (all.length > 1) kept.push(all[all.length - 1]);
  return kept;
}

export const PEN_WIDTH = 4;
export const ERASER_WIDTH = 26;

/** Tamaño de la hoja completa, en píxeles de pantalla con zoom 100 %. */
export const SHEET_WIDTH = 1200;
export const SHEET_HEIGHT = 900;
/** Lado de cada cuadrito con zoom 100 %. */
export const GRID_SIZE = 24;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.25;
/** Segundos que hay que esperar antes de poder confirmar "Borrar todo". */
export const CLEAR_CONFIRM_SECONDS = 3;

type Tool = 'pen' | 'eraser' | 'move';

interface Point {
  x: number;
  y: number;
}

/** Un trazo en coordenadas de la hoja (no de la pantalla), para redibujarlo con cualquier zoom. */
interface Stroke {
  eraser: boolean;
  color: string;
  width: number;
  points: Point[];
}

interface Pinch {
  dist: number;
  mid: Point;
  zoom: number;
  offX: number;
  offY: number;
}

/**
 * Papel cuadriculado para hacer cálculos a mano con el dedo, un lápiz o el mouse.
 * La hoja es más grande que la pantalla: se acerca o aleja con los botones, pellizcando
 * con dos dedos o con Ctrl + rueda, y se recorre con la herramienta "Mover".
 *
 * Privacidad: lo dibujado vive solo en la memoria de esta pantalla (sin toDataURL ni toBlob). Solo
 * `snapshot()` entrega los trazos como datos vectoriales, y quien los usa (CU-A22) los envía únicamente
 * si el niño tiene un docente vinculado. Se borra al cambiar `resetKey` o al salir de la pantalla.
 */
@Component({
  selector: 'app-scratchpad',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: 'scratchpad.component.html',
  styleUrls: ['scratchpad.component.scss'],
})
export class ScratchpadComponent implements AfterViewInit, OnChanges, OnDestroy {
  /** Al cambiar este valor, el papel se limpia. */
  @Input() resetKey: unknown;

  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('sheet', { static: true }) private sheetRef!: ElementRef<HTMLElement>;

  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly colors = PEN_COLORS;
  tool: Tool = 'pen';
  color = PEN_COLORS[0].value;

  /** Zoom actual (1 = 100 %) y desplazamiento de la hoja en la ventana, en px de pantalla. */
  zoom = 1;
  private offX = 0;
  private offY = 0;
  private viewW = 0;
  private viewH = 0;

  private ctx: CanvasRenderingContext2D | null = null;
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  /** Dedos (o mouse) apoyados, en coordenadas de la ventana. */
  private readonly pointers = new Map<number, Point>();
  private pointerId: number | null = null;
  private panLast: Point | null = null;
  private pinch: Pinch | null = null;
  /** Tras pellizcar, el dedo que queda no dibuja hasta levantar todos. */
  private gestureLock = false;
  private observer: ResizeObserver | null = null;
  private ratio = 1;

  /** Aviso "¿Borrar todo?" abierto, y segundos que faltan para poder confirmar. */
  confirmingClear = false;
  clearCountdown = 0;
  private clearTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Copia de los trazos para guardarlos (CU-A22). `null` si no hay nada dibujado con lápiz o si, aun
   * simplificada, la hoja pasa los topes del servidor (entonces no se guarda).
   *
   * - Los puntos se ajustan al rango de la hoja (0 a 1200 y 0 a 900): lo que cae fuera de la hoja no
   *   se ve (el dibujo se recorta a ella) y el servidor rechazaría coordenadas muy lejanas.
   * - Se simplifican: se descartan los puntos a menos de 2 px del anterior (y, si aún pesa mucho, a
   *   menos de 4 u 8 px). Se conservan siempre el primero y el último de cada trazo.
   */
  snapshot(): SheetStroke[] | null {
    const strokes = this.strokes.filter((s) => s.points.length > 0);
    if (!strokes.some((s) => !s.eraser) || strokes.length > SHEET_MAX_STROKES) return null;
    for (const step of SIMPLIFY_STEPS) {
      const out = strokes.map((s) => ({
        eraser: s.eraser,
        color: s.color,
        width: s.width,
        points: simplifyPoints(s.points, step),
      }));
      const total = out.reduce((n, s) => n + s.points.length, 0);
      if (total <= SHEET_MAX_POINTS && out.every((s) => s.points.length <= SHEET_MAX_STROKE_POINTS)) {
        return out;
      }
    }
    return null;
  }

  ngAfterViewInit(): void {
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.canvas);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    const reset = changes['resetKey'];
    if (reset && !reset.firstChange) {
      this.cancelClear();
      this.clear();
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.stopClearTimer();
    this.clear();
  }

  pickColor(value: string): void {
    this.tool = 'pen';
    this.color = value;
  }

  pickEraser(): void {
    this.tool = 'eraser';
  }

  pickMove(): void {
    this.tool = 'move';
  }

  isOn(tool: Tool, color?: string): boolean {
    return this.tool === tool && (color === undefined || this.color === color);
  }

  // --- "Borrar todo" con confirmación -------------------------------------------------------
  // Un toque sin querer no debe borrar el trabajo: primero se pregunta, y "Sí, borrar" queda
  // bloqueado unos segundos (con cuenta regresiva visible).

  askClear(): void {
    if (this.confirmingClear) return;
    this.confirmingClear = true;
    this.clearCountdown = CLEAR_CONFIRM_SECONDS;
    this.stopClearTimer();
    this.clearTimer = setInterval(() => {
      this.clearCountdown = Math.max(0, this.clearCountdown - 1);
      if (this.clearCountdown === 0) this.stopClearTimer();
      this.cdr.markForCheck();
    }, 1000);
    this.cdr.markForCheck();
  }

  confirmClear(): void {
    if (!this.confirmingClear || this.clearCountdown > 0) return;
    this.cancelClear();
    this.clear();
  }

  cancelClear(): void {
    this.stopClearTimer();
    this.confirmingClear = false;
    this.clearCountdown = 0;
    this.cdr.markForCheck();
  }

  private stopClearTimer(): void {
    if (this.clearTimer !== null) clearInterval(this.clearTimer);
    this.clearTimer = null;
  }

  clear(): void {
    this.strokes = [];
    this.current = null;
    this.render();
  }

  // --- Zoom ---------------------------------------------------------------------------------

  get minZoom(): number {
    if (!this.viewW || !this.viewH) return 1;
    return Math.min(1, this.viewW / SHEET_WIDTH, this.viewH / SHEET_HEIGHT);
  }

  get canZoomIn(): boolean {
    return this.zoom < MAX_ZOOM - 1e-6;
  }

  get canZoomOut(): boolean {
    return this.zoom > this.minZoom + 1e-6;
  }

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  zoomIn(): void {
    this.zoomAt(this.zoom * ZOOM_STEP, this.center());
  }

  zoomOut(): void {
    this.zoomAt(this.zoom / ZOOM_STEP, this.center());
  }

  /** Aleja hasta ver la hoja completa. */
  fitSheet(): void {
    this.zoom = this.minZoom;
    this.clampView();
    this.render();
  }

  /** Cambia el zoom dejando quieto el punto de la hoja que está bajo `at`. */
  zoomAt(zoom: number, at: Point): void {
    const next = Math.min(MAX_ZOOM, Math.max(this.minZoom, zoom));
    const wx = (at.x - this.offX) / this.zoom;
    const wy = (at.y - this.offY) / this.zoom;
    this.zoom = next;
    this.offX = at.x - wx * next;
    this.offY = at.y - wy * next;
    this.clampView();
    this.render();
  }

  /** Ctrl + rueda (o pellizco en el trackpad) acerca y aleja. La rueda sola deja hacer scroll. */
  onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoomAt(this.zoom * Math.exp(-event.deltaY * 0.01), this.screenPoint(event));
  }

  // --- Dedos, lápiz y mouse -----------------------------------------------------------------

  onDown(event: PointerEvent): void {
    if (!this.ctx) return;
    // Con mouse, solo el botón principal.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const p = this.screenPoint(event);
    this.pointers.set(event.pointerId, p);
    this.canvas.setPointerCapture?.(event.pointerId);

    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2 || this.gestureLock) return;

    this.pointerId = event.pointerId;
    if (this.tool === 'move') {
      this.panLast = p;
      return;
    }
    const eraser = this.tool === 'eraser';
    const world = this.toWorld(p);
    this.current = {
      eraser,
      color: this.color,
      width: eraser ? ERASER_WIDTH : PEN_WIDTH,
      points: [world],
    };
    this.strokes.push(this.current);
    // Un toque sin mover deja un punto.
    this.drawSegment(this.current, world, world);
  }

  onMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, this.screenPoint(event));

    if (this.pinch) {
      this.updatePinch();
      return;
    }
    if (event.pointerId !== this.pointerId) return;

    if (this.panLast) {
      const p = this.screenPoint(event);
      this.offX += p.x - this.panLast.x;
      this.offY += p.y - this.panLast.y;
      this.panLast = p;
      this.clampView();
      this.render();
      return;
    }

    const stroke = this.current;
    if (!stroke) return;
    const events = event.getCoalescedEvents?.() ?? [];
    for (const e of events.length ? events : [event]) {
      const next = this.toWorld(this.screenPoint(e));
      const last = stroke.points[stroke.points.length - 1];
      stroke.points.push(next);
      this.drawSegment(stroke, last, next);
    }
  }

  onUp(event: PointerEvent): void {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.pinch && this.pointers.size < 2) this.pinch = null;
    if (event.pointerId === this.pointerId) {
      this.pointerId = null;
      this.current = null;
      this.panLast = null;
    }
    if (this.pointers.size === 0) this.gestureLock = false;
  }

  private startPinch(): void {
    // El segundo dedo convierte el gesto en zoom: el trazo que empezó el primero se descarta.
    if (this.current) {
      this.strokes = this.strokes.filter((s) => s !== this.current);
      this.current = null;
      this.render();
    }
    this.pointerId = null;
    this.panLast = null;
    this.gestureLock = true;
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      zoom: this.zoom,
      offX: this.offX,
      offY: this.offY,
    };
  }

  private updatePinch(): void {
    const start = this.pinch;
    if (!start) return;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoom = Math.min(MAX_ZOOM, Math.max(this.minZoom, (start.zoom * dist) / start.dist));
    // El punto de la hoja que estaba entre los dedos sigue entre los dedos.
    const wx = (start.mid.x - start.offX) / start.zoom;
    const wy = (start.mid.y - start.offY) / start.zoom;
    this.zoom = zoom;
    this.offX = mid.x - wx * zoom;
    this.offY = mid.y - wy * zoom;
    this.clampView();
    this.render();
  }

  // --- Dibujo -------------------------------------------------------------------------------

  private get canvas(): HTMLCanvasElement {
    return this.canvasRef.nativeElement;
  }

  private center(): Point {
    return { x: this.viewW / 2, y: this.viewH / 2 };
  }

  private screenPoint(event: { clientX: number; clientY: number }): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toWorld(p: Point): Point {
    return { x: (p.x - this.offX) / this.zoom, y: (p.y - this.offY) / this.zoom };
  }

  /** Mantiene la hoja dentro de la ventana; si cabe entera, la centra. */
  private clampView(): void {
    const fit = (off: number, view: number, size: number) => {
      const content = size * this.zoom;
      if (!view) return off;
      if (content <= view) return (view - content) / 2;
      return Math.min(0, Math.max(view - content, off));
    };
    this.offX = fit(this.offX, this.viewW, SHEET_WIDTH);
    this.offY = fit(this.offY, this.viewH, SHEET_HEIGHT);
  }

  /** Prepara el contexto para dibujar en coordenadas de la hoja, recortado a la hoja. */
  private beginSheet(ctx: CanvasRenderingContext2D): void {
    const k = this.ratio * this.zoom;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, this.ratio * this.offX, this.ratio * this.offY);
    ctx.beginPath();
    ctx.rect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
    ctx.clip();
  }

  private applyStyle(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  /** Dibuja solo el tramo nuevo mientras el dedo se mueve (rápido aunque haya mucho dibujado). */
  private drawSegment(stroke: Stroke, from: Point, to: Point): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.beginSheet(ctx);
    this.applyStyle(ctx, stroke);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    // Un punto (from = to) necesita un trazo mínimo para verse.
    ctx.lineTo(to.x + (from.x === to.x && from.y === to.y ? 0.01 : 0), to.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Redibuja todo con el zoom y la posición actuales. */
  private render(): void {
    this.updateSheet();
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    if (!this.strokes.length) return;
    this.beginSheet(ctx);
    for (const stroke of this.strokes) {
      this.applyStyle(ctx, stroke);
      const [first, ...rest] = stroke.points;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      if (rest.length) for (const p of rest) ctx.lineTo(p.x, p.y);
      else ctx.lineTo(first.x + 0.01, first.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Mueve y escala el fondo cuadriculado junto con lo dibujado. */
  private updateSheet(): void {
    const style = this.sheetRef?.nativeElement.style;
    if (!style) return;
    style.width = `${SHEET_WIDTH * this.zoom}px`;
    style.height = `${SHEET_HEIGHT * this.zoom}px`;
    style.transform = `translate(${this.offX}px, ${this.offY}px)`;
    style.backgroundSize = `${GRID_SIZE * this.zoom}px ${GRID_SIZE * this.zoom}px`;
  }

  /** Ajusta el canvas a su tamaño en pantalla (nítido en pantallas de alta densidad). */
  private resize(): void {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.ratio = ratio;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    if (this.zoom < this.minZoom) this.zoom = this.minZoom;
    this.clampView();
    this.render();
  }
}
