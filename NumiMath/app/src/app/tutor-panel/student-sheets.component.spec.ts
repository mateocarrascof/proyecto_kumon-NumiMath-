import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular/lazy';

import { ParentalPort, PinError } from '../core/parental/parental.port';
import { SheetViewComponent } from '../core/sheets/sheet-view.component';
import {
  TutorSheetDetail,
  TutorSheetItem,
  TutorSheetsPort,
} from '../core/sheets/tutor-sheets.port';
import { StudentSheetsComponent } from './student-sheets.component';

const item = (over: Partial<TutorSheetItem> = {}): TutorSheetItem => ({
  id: 'h1',
  label: 'Restas',
  tutorTask: false,
  correct: false,
  statement: '75 - 38',
  savedAt: '2026-11-12T15:30:00Z',
  ...over,
});
const DETAIL: TutorSheetDetail = {
  ...item(),
  childAnswer: '47',
  correctAnswer: '37',
  strokes: [{ eraser: false, color: '#2b2d42', width: 4, points: [[10, 10], [60, 40]] }],
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

function setup(over: {
  items?: TutorSheetItem[];
  total?: number;
  verify?: () => Promise<void>;
  remove?: () => Promise<unknown>;
  removeAll?: () => Promise<unknown>;
} = {}) {
  const items = over.items ?? [item(), item({ id: 'h2', tutorTask: true, statement: 'Tarea del tutor', correct: true })];
  const ctx2d = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx2d as unknown as CanvasRenderingContext2D,
  );
  const sheets = {
    list: vi.fn(async () => ({
      ok: true,
      page: { items, hasMore: false, nextOffset: null, total: over.total ?? items.length },
    })),
    get: vi.fn(async () => ({ ok: true, sheet: DETAIL })),
    remove: vi.fn(over.remove ?? (async () => ({ ok: true, deleted: 1 }))),
    removeAll: vi.fn(over.removeAll ?? (async () => ({ ok: true, deleted: items.length }))),
  };
  const parental = { verify: vi.fn(over.verify ?? (async () => undefined)) };
  TestBed.configureTestingModule({
    declarations: [StudentSheetsComponent, SheetViewComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: TutorSheetsPort, useValue: sheets },
      { provide: ParentalPort, useValue: parental },
    ],
  });
  const fixture = TestBed.createComponent(StudentSheetsComponent);
  const c = fixture.componentInstance;
  c.studentId = 'perfil-1';
  c.nickname = 'Ana';
  const el = fixture.nativeElement as HTMLElement;
  return {
    c,
    fixture,
    el,
    sheets,
    parental,
    ctx2d,
    async load() {
      await c.ngOnChanges({ studentId: new SimpleChange(null, 'perfil-1', true) });
      fixture.detectChanges();
    },
    q: (selector: string) => el.querySelector(selector) as HTMLElement | null,
  };
}

describe('StudentSheetsComponent (T27)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lista las hojas con ejercicio, habilidad, fecha y hora de Chile, y resultado', async () => {
    const t = setup();
    await t.load();
    const rows = t.el.querySelectorAll('[data-testid="sheet-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('75 - 38');
    expect(rows[0].textContent).toContain('Restas');
    expect(rows[0].textContent).toMatch(/12-11-2026,? 12:30/);
    expect(rows[0].querySelector('[data-testid="result"]')?.textContent).toContain('Incorrecta');
    expect(rows[1].textContent).toContain('Tarea del tutor');
    expect(t.sheets.list).toHaveBeenCalledWith('perfil-1', 0);
  });

  it('sin hojas muestra el mensaje y no ofrece borrar todas', async () => {
    const t = setup({ items: [], total: 0 });
    await t.load();
    expect(t.q('[data-testid="sheets-empty"]')).not.toBeNull();
    expect(t.q('[data-testid="remove-all"]')).toBeNull();
  });

  it('abre una hoja y la dibuja con el visor compartido (app-sheet-view)', async () => {
    const t = setup();
    await t.load();
    (t.q('[data-testid="open-sheet"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    t.fixture.detectChanges();
    expect(t.sheets.get).toHaveBeenCalledWith('perfil-1', 'h1');
    expect(t.q('app-sheet-view')).not.toBeNull();
    expect(t.ctx2d.stroke).toHaveBeenCalledTimes(1);
    expect(t.q('[data-testid="sheet-answers"]')?.textContent).toContain('47');
    expect(t.q('[data-testid="sheet-answers"]')?.textContent).toContain('37');
  });

  describe('borrar una hoja', () => {
    it('pide confirmación y PIN, y solo borra tras verificar el PIN', async () => {
      const t = setup();
      await t.load();
      (t.q('[data-testid="remove-sheet"]') as HTMLElement).click();
      t.fixture.detectChanges();
      expect(t.q('[data-testid="confirm-text"]')?.textContent).toContain('No se puede deshacer');
      expect(t.q('[data-testid="confirm-text"]')?.textContent).toContain('docente dejará de verla');
      expect(t.sheets.remove).not.toHaveBeenCalled();
      t.c.onPin('12a34');
      expect(t.c.pin).toBe('1234');
      await t.c.confirmRemove();
      t.fixture.detectChanges();
      expect(t.parental.verify).toHaveBeenCalledWith('1234');
      expect(t.parental.verify.mock.invocationCallOrder[0]).toBeLessThan(
        t.sheets.remove.mock.invocationCallOrder[0],
      );
      expect(t.sheets.remove).toHaveBeenCalledWith('perfil-1', 'h1');
      expect(t.q('[data-testid="sheets-notice"]')?.textContent).toContain('La hoja se borró');
      expect(t.sheets.list).toHaveBeenCalledTimes(2); // recarga la lista
    });

    it('sin 4 dígitos no se puede confirmar', async () => {
      const t = setup();
      await t.load();
      t.c.askRemove(item());
      t.c.onPin('12');
      await t.c.confirmRemove();
      expect(t.parental.verify).not.toHaveBeenCalled();
      expect(t.sheets.remove).not.toHaveBeenCalled();
    });

    it('con un PIN incorrecto no borra nada y lo dice', async () => {
      const t = setup({
        verify: async () => {
          throw new PinError('wrong', 2);
        },
      });
      await t.load();
      t.c.askRemove(item());
      t.c.onPin('0000');
      await t.c.confirmRemove();
      t.fixture.detectChanges();
      expect(t.sheets.remove).not.toHaveBeenCalled();
      expect(t.q('[data-testid="sheets-confirm-error"]')).not.toBeNull();
      expect(t.c.pin).toBe('');
    });

    it('cancelar no borra nada ni pide el PIN', async () => {
      const t = setup();
      await t.load();
      t.c.askRemove(item());
      t.c.cancelConfirm();
      t.fixture.detectChanges();
      expect(t.q('[data-testid="sheets-confirm"]')).toBeNull();
      expect(t.parental.verify).not.toHaveBeenCalled();
    });

    it('si el servidor falla, avisa y deja la hoja en la lista', async () => {
      const t = setup({ remove: async () => ({ ok: false, reason: 'error' }) });
      await t.load();
      t.c.askRemove(item());
      t.c.onPin('1234');
      await t.c.confirmRemove();
      t.fixture.detectChanges();
      expect(t.q('[data-testid="sheets-confirm-error"]')?.textContent).toContain('No pude completar');
      expect(t.sheets.list).toHaveBeenCalledTimes(1);
    });

    it('desde la hoja abierta también se puede borrar (con el mismo PIN y confirmación)', async () => {
      const t = setup();
      await t.load();
      await t.c.open(item());
      t.fixture.detectChanges();
      (t.q('[data-testid="remove-opened"]') as HTMLElement).click();
      t.fixture.detectChanges();
      expect(t.q('[data-testid="sheets-confirm"]')).not.toBeNull();
      t.c.onPin('1234');
      await t.c.confirmRemove();
      expect(t.sheets.remove).toHaveBeenCalledWith('perfil-1', 'h1');
      expect(t.c.opened).toBeNull();
    });
  });

  describe('borrar todas', () => {
    it('la confirmación dice cuántas hojas se borran y que no se puede deshacer', async () => {
      const t = setup({ total: 7 });
      await t.load();
      (t.q('[data-testid="remove-all"]') as HTMLElement).click();
      t.fixture.detectChanges();
      const text = t.q('[data-testid="confirm-text"]')?.textContent ?? '';
      expect(text).toContain('7');
      expect(text).toContain('hojas guardadas');
      expect(text).toContain('No se puede deshacer');
      expect(text).toContain('Ana');
      expect(t.sheets.removeAll).not.toHaveBeenCalled();
    });

    it('con 1 sola hoja lo dice en singular', async () => {
      const t = setup({ items: [item()], total: 1 });
      await t.load();
      t.c.askRemoveAll();
      t.fixture.detectChanges();
      expect(t.q('[data-testid="confirm-text"]')?.textContent).toContain('1 hoja guardada');
    });

    it('verifica el PIN, borra todas, informa cuántas y recarga', async () => {
      const t = setup({ total: 2, removeAll: async () => ({ ok: true, deleted: 2 }) });
      await t.load();
      t.c.askRemoveAll();
      t.c.onPin('1234');
      await t.c.confirmRemove();
      t.fixture.detectChanges();
      expect(t.parental.verify).toHaveBeenCalledWith('1234');
      expect(t.sheets.removeAll).toHaveBeenCalledWith('perfil-1');
      expect(t.q('[data-testid="sheets-notice"]')?.textContent).toContain('Se borraron 2 hojas');
      expect(t.sheets.list).toHaveBeenCalledTimes(2);
    });

    it('cada borrado pide el PIN otra vez (nunca reutiliza uno anterior)', async () => {
      const t = setup();
      await t.load();
      t.c.askRemoveAll();
      t.c.onPin('1234');
      await t.c.confirmRemove();
      t.c.askRemoveAll();
      expect(t.c.pin).toBe('');
      await t.c.confirmRemove(); // sin PIN escrito: no hace nada
      expect(t.sheets.removeAll).toHaveBeenCalledTimes(1);
    });
  });

  it('si no puede cargar las hojas lo dice sin mostrar datos', async () => {
    const t = setup();
    t.sheets.list.mockResolvedValueOnce({ ok: false, reason: 'error' } as never);
    await t.load();
    expect(t.q('[data-testid="sheets-error"]')).not.toBeNull();
    expect(t.q('[data-testid="sheets-list"]')).toBeNull();
  });
});
