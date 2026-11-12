import { Component, NgModule, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CoreModule } from '../core.module';
import {
  CLEAR_CONFIRM_SECONDS,
  ERASER_WIDTH,
  MAX_ZOOM,
  PEN_COLORS,
  PEN_WIDTH,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  ScratchpadComponent,
} from './scratchpad.component';

/** Contexto 2D falso: jsdom no dibuja en canvas. */
function fakeContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    globalCompositeOperation: 'source-over',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
}

@Component({
  standalone: false,
  template: `<app-scratchpad [resetKey]="key()"></app-scratchpad>`,
})
class HostComponent {
  readonly key = signal('ejercicio-1');
}

@NgModule({ imports: [CoreModule], declarations: [HostComponent] })
class HostModule {}

function pointer(x: number, y: number, extra: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    preventDefault: vi.fn(),
    ...extra,
  } as unknown as PointerEvent;
}

/** `size`: tamaño en pantalla de la ventana al papel (jsdom no hace layout). */
function setup(size?: { width: number; height: number }) {
  const ctx = fakeContext();
  if (size) {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      ...size,
    } as DOMRect);
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  TestBed.configureTestingModule({ imports: [HostModule] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const pad = fixture.debugElement.children[0].componentInstance as ScratchpadComponent;
  return { fixture, pad, ctx };
}

describe('ScratchpadComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('empieza con el lápiz del primer color', () => {
    const { pad } = setup();
    expect(pad.tool).toBe('pen');
    expect(pad.color).toBe(PEN_COLORS[0].value);
  });

  it('dibuja un trazo con el dedo usando el color elegido', () => {
    const { pad, ctx } = setup();
    pad.pickColor(PEN_COLORS[1].value);
    pad.onDown(pointer(10, 10));
    pad.onMove(pointer(30, 40));
    pad.onUp(pointer(30, 40));
    expect(ctx.lineTo).toHaveBeenLastCalledWith(30, 40);
    expect(ctx.strokeStyle).toBe(PEN_COLORS[1].value);
    expect(ctx.lineWidth).toBe(PEN_WIDTH);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('la goma borra en vez de pintar', () => {
    const { pad, ctx } = setup();
    pad.pickEraser();
    expect(pad.isOn('eraser')).toBe(true);
    pad.onDown(pointer(5, 5));
    pad.onMove(pointer(15, 5));
    expect(ctx.globalCompositeOperation).toBe('destination-out');
    expect(ctx.lineWidth).toBe(ERASER_WIDTH);
  });

  it('elegir un color vuelve al lápiz', () => {
    const { pad } = setup();
    pad.pickEraser();
    pad.pickColor(PEN_COLORS[2].value);
    expect(pad.tool).toBe('pen');
    expect(pad.isOn('pen', PEN_COLORS[2].value)).toBe(true);
  });

  it('no dibuja al mover sin haber tocado, ni con otro dedo', () => {
    const { pad, ctx } = setup();
    pad.onMove(pointer(30, 40));
    expect(ctx.stroke).not.toHaveBeenCalled();
    pad.onDown(pointer(0, 0));
    ctx.stroke.mockClear();
    pad.onMove(pointer(9, 9, { pointerId: 2 }));
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('con mouse solo dibuja el botón principal', () => {
    const { pad, ctx } = setup();
    pad.onDown(pointer(0, 0, { pointerType: 'mouse', button: 2 }));
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('"Borrar todo" limpia el papel', () => {
    const { pad, ctx } = setup();
    pad.clear();
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it('se limpia solo al pasar a otro ejercicio', () => {
    const { fixture, ctx } = setup();
    ctx.clearRect.mockClear();
    fixture.componentInstance.key.set('ejercicio-2');
    fixture.detectChanges();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
  });

  describe('snapshot para guardar la hoja (CU-A22)', () => {
    it('sin nada dibujado, o solo con goma, no hay hoja que guardar', () => {
      const { pad } = setup();
      expect(pad.snapshot()).toBeNull();
      pad.pickEraser();
      pad.onDown(pointer(5, 5));
      pad.onUp(pointer(5, 5));
      expect(pad.snapshot()).toBeNull();
    });

    it('entrega solo trazos vectoriales con puntos enteros, en coordenadas de la hoja', () => {
      const { pad } = setup();
      pad.pickColor(PEN_COLORS[1].value);
      pad.onDown(pointer(10, 10));
      pad.onMove(pointer(30, 40));
      pad.onUp(pointer(30, 40));
      pad.pickEraser();
      pad.onDown(pointer(12, 12));
      pad.onUp(pointer(12, 12));
      const strokes = pad.snapshot();
      expect(strokes).toHaveLength(2);
      expect(strokes?.[0]).toEqual({
        eraser: false,
        color: PEN_COLORS[1].value,
        width: PEN_WIDTH,
        points: [
          [10, 10],
          [30, 40],
        ],
      });
      expect(strokes?.[1].eraser).toBe(true);
      expect(Object.keys(strokes?.[0] ?? {}).sort()).toEqual(['color', 'eraser', 'points', 'width']);
    });

    it('si pasa los topes del servidor no se guarda (en vez de fallar)', () => {
      const { pad } = setup();
      pad.onDown(pointer(1, 1));
      pad.onUp(pointer(1, 1));
      const internal = pad as unknown as { strokes: { points: unknown[] }[] };
      internal.strokes = Array.from({ length: 601 }, () => internal.strokes[0]);
      expect(pad.snapshot()).toBeNull();
    });

    it('"Borrar todo" deja la hoja vacía', () => {
      const { pad } = setup();
      pad.onDown(pointer(1, 1));
      pad.onUp(pointer(1, 1));
      expect(pad.snapshot()).not.toBeNull();
      pad.clear();
      expect(pad.snapshot()).toBeNull();
    });
  });

  describe('zoom', () => {
    const VIEW = { width: 480, height: 360 };

    it('empieza al 100 % y "Acercar" dibuja más grande en el mismo lugar de la hoja', () => {
      const { pad, ctx } = setup(VIEW);
      expect(pad.zoom).toBe(1);
      pad.zoomIn();
      expect(pad.zoom).toBeGreaterThan(1);
      // Tocar el centro de la ventana sigue siendo el mismo punto de la hoja (240, 180).
      pad.onDown(pointer(240, 180));
      expect(ctx.moveTo).toHaveBeenLastCalledWith(240, 180);
    });

    it('no acerca más allá del máximo', () => {
      const { pad } = setup(VIEW);
      for (let i = 0; i < 20; i++) pad.zoomIn();
      expect(pad.zoom).toBe(MAX_ZOOM);
      expect(pad.canZoomIn).toBe(false);
    });

    it('"Ver toda la hoja" aleja hasta que la hoja cabe entera, y no más', () => {
      const { pad } = setup(VIEW);
      pad.fitSheet();
      expect(pad.zoom).toBeCloseTo(Math.min(VIEW.width / SHEET_WIDTH, VIEW.height / SHEET_HEIGHT));
      expect(pad.canZoomOut).toBe(false);
      pad.zoomOut();
      expect(pad.zoom).toBeCloseTo(pad.minZoom);
    });

    it('al alejar, lo dibujado se redibuja con el nuevo tamaño', () => {
      const { pad, ctx } = setup(VIEW);
      pad.onDown(pointer(10, 10));
      pad.onMove(pointer(50, 10));
      pad.onUp(pointer(50, 10));
      ctx.stroke.mockClear();
      ctx.setTransform.mockClear();
      pad.zoomOut();
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
      const [k] = ctx.setTransform.mock.calls.at(-1)!;
      expect(k).toBeCloseTo(pad.zoom * (globalThis.devicePixelRatio || 1));
    });

    it('pellizcar con dos dedos hace zoom y no deja raya', () => {
      const { pad, ctx } = setup(VIEW);
      pad.onDown(pointer(200, 180, { pointerId: 1 }));
      pad.onDown(pointer(280, 180, { pointerId: 2 }));
      pad.onMove(pointer(160, 180, { pointerId: 1 }));
      pad.onMove(pointer(320, 180, { pointerId: 2 }));
      expect(pad.zoom).toBeCloseTo(2);
      // Al levantar un dedo, el otro no empieza a dibujar.
      pad.onUp(pointer(320, 180, { pointerId: 2 }));
      ctx.stroke.mockClear();
      pad.onMove(pointer(100, 100, { pointerId: 1 }));
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('"Mover" recorre la hoja sin dibujar', () => {
      const { pad, ctx } = setup(VIEW);
      pad.zoomIn();
      pad.pickMove();
      ctx.lineTo.mockClear();
      pad.onDown(pointer(200, 200));
      pad.onMove(pointer(250, 230));
      pad.onUp(pointer(250, 230));
      expect(ctx.lineTo).not.toHaveBeenCalled();
      // Tras mover, el mismo punto de pantalla cae en otro punto de la hoja.
      pad.pickColor(PEN_COLORS[0].value);
      pad.onDown(pointer(250, 230));
      const [x, y] = ctx.moveTo.mock.calls.at(-1)!;
      expect(x).toBeCloseTo(200 / pad.zoom + (240 - 240 / pad.zoom));
      expect(y).toBeCloseTo(200 / pad.zoom + (180 - 180 / pad.zoom));
    });

    it('Ctrl + rueda hace zoom; la rueda sola no', () => {
      const { pad } = setup(VIEW);
      const wheel = (extra: Partial<WheelEvent>) =>
        ({ clientX: 240, clientY: 180, deltaY: -100, preventDefault: vi.fn(), ...extra }) as unknown as WheelEvent;
      pad.onWheel(wheel({ ctrlKey: false }));
      expect(pad.zoom).toBe(1);
      pad.onWheel(wheel({ ctrlKey: true }));
      expect(pad.zoom).toBeGreaterThan(1);
    });
  });

  describe('"Borrar todo" con confirmación', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function drawSomething(pad: ScratchpadComponent) {
      pad.onDown(pointer(10, 10));
      pad.onMove(pointer(30, 30));
      pad.onUp(pointer(30, 30));
    }

    it('apretar "Borrar todo" no borra: solo pregunta', () => {
      const { fixture, pad, ctx } = setup();
      drawSomething(pad);
      ctx.clearRect.mockClear();
      const button = fixture.nativeElement.querySelector('button.clear') as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
      expect(ctx.clearRect).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="clear-confirm"]')).not.toBeNull();
    });

    it('"Sí, borrar" está bloqueado durante la cuenta regresiva', () => {
      const { fixture, pad, ctx } = setup();
      pad.askClear();
      fixture.detectChanges();
      const yes = () => fixture.nativeElement.querySelector('[data-testid="clear-yes"]') as HTMLButtonElement;
      expect(yes().disabled).toBe(true);
      expect(yes().textContent).toContain(String(CLEAR_CONFIRM_SECONDS));

      vi.advanceTimersByTime((CLEAR_CONFIRM_SECONDS - 1) * 1000);
      fixture.detectChanges();
      expect(yes().disabled).toBe(true);
      ctx.clearRect.mockClear();
      pad.confirmClear();
      expect(ctx.clearRect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      expect(yes().disabled).toBe(false);
      yes().click();
      fixture.detectChanges();
      expect(ctx.clearRect).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('[data-testid="clear-confirm"]')).toBeNull();
    });

    it('"No, volver" cierra el aviso sin borrar', () => {
      const { fixture, pad, ctx } = setup();
      pad.askClear();
      vi.advanceTimersByTime(CLEAR_CONFIRM_SECONDS * 1000);
      ctx.clearRect.mockClear();
      pad.cancelClear();
      fixture.detectChanges();
      expect(ctx.clearRect).not.toHaveBeenCalled();
      expect(pad.confirmingClear).toBe(false);
      // Volver a preguntar reinicia la espera.
      pad.askClear();
      expect(pad.clearCountdown).toBe(CLEAR_CONFIRM_SECONDS);
    });

    it('pasar a otro ejercicio cierra el aviso', () => {
      const { fixture, pad } = setup();
      pad.askClear();
      fixture.componentInstance.key.set('ejercicio-2');
      fixture.detectChanges();
      expect(pad.confirmingClear).toBe(false);
    });
  });
});
