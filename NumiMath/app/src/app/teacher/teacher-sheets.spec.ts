import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { SheetDetail, SheetsResult, SheetResult, TeacherPort } from '../core/teacher/teacher.port';
import { SheetViewComponent } from './sheet-view.component';
import { TeacherSheetsPage } from './teacher-sheets.page';

const STROKE = { eraser: false, color: '#2b2d42', width: 4, points: [[10, 10], [60, 40]] as [number, number][] };
const DETAIL: SheetDetail = {
  id: 'h1',
  label: 'Restas',
  tutorTask: false,
  correct: false,
  day: '2026-11-12',
  statement: '75 - 38',
  childAnswer: '47',
  correctAnswer: '37',
  strokes: [STROKE, { ...STROKE, eraser: true }],
};

function fakeContext() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    globalCompositeOperation: 'source-over',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
}

async function render(teacher: Record<string, unknown>) {
  const ctx = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  TestBed.configureTestingModule({
    declarations: [TeacherSheetsPage, SheetViewComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: TeacherPort, useValue: teacher },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'perfil-1']]) } } },
    ],
  });
  const fixture = TestBed.createComponent(TeacherSheetsPage);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  return { fixture, page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, ctx };
}

describe('TeacherSheetsPage (D8)', () => {
  afterEach(() => vi.restoreAllMocks());

  const list: SheetsResult = {
    ok: true,
    page: {
      items: [
        { id: 'h1', label: 'Restas', tutorTask: false, correct: false, day: '2026-11-12' },
        { id: 'h2', label: 'Tarea del tutor', tutorTask: true, correct: true, day: '2026-11-11' },
      ],
      hasMore: false,
      nextOffset: null,
    },
  };

  it('lista las hojas con habilidad, día y resultado, sin trazos ni textos', async () => {
    const listSheets = vi.fn(async () => list);
    const { el } = await render({ listSheets });
    expect(listSheets).toHaveBeenCalledWith('perfil-1', 0);
    const rows = el.querySelectorAll('[data-testid="sheet-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Restas');
    expect(rows[0].textContent).toContain('12-11-2026');
    expect(rows[1].textContent).toContain('Tarea escrita por el tutor');
    expect(el.querySelector('app-sheet-view')).toBeNull();
  });

  it('abre una hoja y dibuja los trazos sobre la cuadrícula, con las dos respuestas', async () => {
    const getSheet = vi.fn(async (): Promise<SheetResult> => ({ ok: true, sheet: DETAIL }));
    const { fixture, el, ctx } = await render({ listSheets: async () => list, getSheet });
    (el.querySelector('[data-testid="sheet-row"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(getSheet).toHaveBeenCalledWith('perfil-1', 'h1');
    expect(el.querySelector('[data-testid="sheet-statement"]')?.textContent).toContain('75 - 38');
    const answers = el.querySelector('[data-testid="sheet-answers"]')?.textContent ?? '';
    expect(answers).toContain('47');
    expect(answers).toContain('incorrecta');
    expect(answers).toContain('37');
    expect(el.querySelector('app-sheet-view .sheet')).not.toBeNull();
    // Dos trazos: el del lápiz y el de la goma (borra tinta, no la cuadrícula del fondo).
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('en una tarea del tutor nunca muestra su texto', async () => {
    const sheet: SheetDetail = { ...DETAIL, tutorTask: true, statement: 'Tarea del tutor' };
    const { fixture, el } = await render({
      listSheets: async () => list,
      getSheet: async () => ({ ok: true, sheet }),
    });
    (el.querySelectorAll('[data-testid="sheet-row"]')[1] as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="sheet-statement"]')?.textContent).toContain(
      'Tarea escrita por el tutor',
    );
  });

  it('volver a la lista cierra la hoja', async () => {
    const { fixture, el, page } = await render({
      listSheets: async () => list,
      getSheet: async () => ({ ok: true, sheet: DETAIL }),
    });
    await page.open(list.ok ? list.page.items[0] : (undefined as never));
    fixture.detectChanges();
    (el.querySelector('[data-testid="sheet-back"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="sheets-list"]')).not.toBeNull();
  });

  it('sin hojas avisa que todavía no hay desde el vínculo', async () => {
    const { el } = await render({
      listSheets: async () => ({ ok: true, page: { items: [], hasMore: false, nextOffset: null } }),
    });
    expect(el.querySelector('[data-testid="sheets-empty"]')?.textContent).toContain(
      'desde el vínculo',
    );
  });

  it('sin vínculo (404) dice lo mismo que si el alumno no existiera', async () => {
    const { el } = await render({ listSheets: async () => ({ ok: false, reason: 'not_found' }) });
    expect(el.querySelector('[data-testid="sheets-error"]')?.textContent).toContain(
      'No encontramos a ese alumno',
    );
  });

  it('si no puede abrir una hoja lo dice y sigue en la lista', async () => {
    const { fixture, el } = await render({
      listSheets: async () => list,
      getSheet: async () => ({ ok: false, reason: 'error' }),
    });
    (el.querySelector('[data-testid="sheet-row"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="sheet-open-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="sheets-list"]')).not.toBeNull();
  });

  it('carga más hojas con el siguiente desplazamiento', async () => {
    const listSheets = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        page: { items: list.ok ? list.page.items : [], hasMore: true, nextOffset: 2 },
      })
      .mockResolvedValueOnce({ ok: true, page: { items: [], hasMore: false, nextOffset: null } });
    const { fixture, el } = await render({ listSheets });
    (el.querySelector('[data-testid="sheets-more"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(listSheets).toHaveBeenLastCalledWith('perfil-1', 2);
    expect(el.querySelector('[data-testid="sheets-more"]')).toBeNull();
  });
});
