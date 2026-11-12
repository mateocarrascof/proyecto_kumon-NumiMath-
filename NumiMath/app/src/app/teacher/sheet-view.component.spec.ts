import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { SHEET_HEIGHT, SHEET_WIDTH } from '../core/scratchpad/scratchpad.component';
import { SheetStroke } from '../core/sheets/sheets.port';
import { SheetDetail, TeacherPort } from '../core/teacher/teacher.port';
import { SheetViewComponent } from './sheet-view.component';
import { TeacherSheetsPage } from './teacher-sheets.page';

const STROKES: SheetStroke[] = [
  { eraser: false, color: '#2b2d42', width: 4, points: [[36, 9], [346, 133]] },
  { eraser: false, color: '#c0392b', width: 4, points: [[100, 100]] },
];
const DETAIL: SheetDetail = {
  id: 'h1',
  label: 'Restas',
  tutorTask: false,
  correct: false,
  day: '2026-11-12',
  statement: '75 - 38',
  childAnswer: '47',
  correctAnswer: '37',
  strokes: STROKES,
};

/**
 * jsdom no pinta píxeles, pero SÍ reproduce lo que borraba el dibujo en el navegador: cambiar el
 * tamaño de un canvas (por la propiedad o por el atributo `width`/`height`) lo vacía. Se registra el
 * ORDEN de esos cambios y de los trazos. Se usa el componente real dentro de su pantalla real
 * (`TeacherSheetsPage`, que le pasa `[strokes]`): así Angular llama a `ngOnChanges` del visor ANTES de
 * actualizar los enlaces de su propia plantilla, que es donde estaba el problema.
 */
function record() {
  const events: string[] = [];
  const ctx = {
    clearRect: vi.fn(() => events.push('clear')),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => events.push('stroke')),
    globalCompositeOperation: 'source-over',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  for (const prop of ['width', 'height'] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
    Object.defineProperty(HTMLCanvasElement.prototype, prop, {
      configurable: true,
      get: original?.get,
      set(value: number) {
        events.push(`size:${prop}`);
        original?.set?.call(this, value);
      },
    });
  }
  const setAttribute = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (
    this: Element,
    name: string,
    value: string,
  ) {
    if (this instanceof HTMLCanvasElement && (name === 'width' || name === 'height')) {
      events.push(`size:${name}`);
    }
    return setAttribute.call(this, name, value);
  });
  return { events, ctx };
}

async function openSheet() {
  TestBed.configureTestingModule({
    declarations: [TeacherSheetsPage, SheetViewComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      {
        provide: TeacherPort,
        useValue: {
          listSheets: async () => ({
            ok: true,
            page: {
              items: [{ id: 'h1', label: 'Restas', tutorTask: false, correct: false, day: '2026-11-12' }],
              hasMore: false,
              nextOffset: null,
            },
          }),
          getSheet: async () => ({ ok: true, sheet: DETAIL }),
        },
      },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'perfil-1']]) } } },
    ],
  });
  const fixture = TestBed.createComponent(TeacherSheetsPage);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.componentInstance.open(fixture.componentInstance.items[0]);
  fixture.detectChanges();
  return fixture;
}

describe('SheetViewComponent (dentro de la pantalla de hojas del docente)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('no cambia el tamaño del canvas después de dibujar (hacerlo borra los trazos)', async () => {
    const { events, ctx } = record();
    await openSheet();
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    const firstStroke = events.indexOf('stroke');
    // Ningún cambio de tamaño (propiedad o atributo) a partir del primer trazo.
    expect(events.slice(firstStroke).some((e) => e.startsWith('size:'))).toBe(false);
  });

  it('el canvas tiene el tamaño de la hoja (1200 x 900) desde que se crea', async () => {
    record();
    const fixture = await openSheet();
    const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(SHEET_WIDTH);
    expect(canvas.height).toBe(SHEET_HEIGHT);
  });

  it('al cambiar los trazos redibuja sin tocar el tamaño', async () => {
    const { events, ctx } = record();
    const fixture = await openSheet();
    events.length = 0;
    ctx.stroke.mockClear();
    fixture.componentInstance.opened = { ...DETAIL, strokes: [STROKES[0]] };
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck(); // la pantalla es OnPush
    fixture.detectChanges();
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.startsWith('size:'))).toBe(false);
  });
});
