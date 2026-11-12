import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular/lazy';

import { AttemptEntry, AttemptsResult, HistoryPort } from '../core/history/history.port';
import { StudentHistoryComponent, formatWhen } from './student-history.component';

const entry = (over: Partial<AttemptEntry> = {}): AttemptEntry => ({
  label: 'Contar de 2 en 2',
  tutorTask: false,
  correct: true,
  level: 2,
  answeredAt: '2026-11-12T15:30:00Z',
  ...over,
});

function setup(pages: AttemptsResult[]) {
  const page = vi.fn();
  for (const result of pages) page.mockResolvedValueOnce(result);
  TestBed.configureTestingModule({
    declarations: [StudentHistoryComponent],
    imports: [IonicModule.forRoot()],
    providers: [{ provide: HistoryPort, useValue: { page } }],
  });
  const fixture = TestBed.createComponent(StudentHistoryComponent);
  const c = fixture.componentInstance;
  c.studentId = 'perfil-1';
  c.nickname = 'Ana';
  return {
    c,
    fixture,
    page,
    async load() {
      await c.ngOnChanges({ studentId: new SimpleChange(null, 'perfil-1', true) });
      fixture.detectChanges();
    },
  };
}

describe('StudentHistoryComponent (T5)', () => {
  it('muestra habilidad, resultado, nivel y hora de cada intento', async () => {
    const ctx = setup([
      { ok: true, page: { items: [entry(), entry({ correct: false, label: 'Tareas del tutor', tutorTask: true })], hasMore: false, nextOffset: null } },
    ]);
    await ctx.load();
    const el = ctx.fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('[data-testid="history-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Contar de 2 en 2');
    expect(rows[0].textContent).toContain('Nivel 2');
    expect(rows[0].textContent).toMatch(/12-11-2026,? 12:30/); // hora de Chile (UTC-3 en noviembre)
    expect(rows[1].querySelector('[data-testid="result"]')?.textContent).toContain('Incorrecta');
    expect(ctx.page).toHaveBeenCalledWith('perfil-1', 0);
  });

  it('sin intentos muestra la lista vacía', async () => {
    const ctx = setup([{ ok: true, page: { items: [], hasMore: false, nextOffset: null } }]);
    await ctx.load();
    expect((ctx.fixture.nativeElement as HTMLElement).querySelector('[data-testid="history-empty"]')).not.toBeNull();
  });

  it('pagina con "Cargar más"', async () => {
    const ctx = setup([
      { ok: true, page: { items: [entry()], hasMore: true, nextOffset: 1 } },
      { ok: true, page: { items: [entry({ level: 3 })], hasMore: false, nextOffset: null } },
    ]);
    await ctx.load();
    expect((ctx.fixture.nativeElement as HTMLElement).querySelector('[data-testid="history-more"]')).not.toBeNull();
    await ctx.c.more();
    ctx.fixture.detectChanges();
    expect(ctx.page).toHaveBeenNthCalledWith(2, 'perfil-1', 1);
    expect((ctx.fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="history-row"]').length).toBe(2);
    expect((ctx.fixture.nativeElement as HTMLElement).querySelector('[data-testid="history-more"]')).toBeNull();
  });

  it('si el PIN venció lo dice', async () => {
    const ctx = setup([{ ok: false, reason: 'pin' }]);
    await ctx.load();
    expect(ctx.c.error).toContain('PIN venció');
  });

  it('un fallo lo dice y no deja datos viejos al cambiar de hijo', async () => {
    const ctx = setup([
      { ok: true, page: { items: [entry()], hasMore: false, nextOffset: null } },
      { ok: false, reason: 'network' },
    ]);
    await ctx.load();
    ctx.c.studentId = 'perfil-2';
    await ctx.c.ngOnChanges({ studentId: new SimpleChange('perfil-1', 'perfil-2', false) });
    expect(ctx.c.items).toEqual([]);
    expect(ctx.c.error).toContain('No pude cargar');
  });

  it('da formato a la hora y tolera un texto raro', () => {
    expect(formatWhen('2026-11-12T15:30:00Z')).toContain('12:30');
    expect(formatWhen('raro')).toBe('raro');
  });
});
