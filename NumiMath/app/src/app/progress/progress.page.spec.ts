import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { WeeklyChartComponent } from '../core/charts/weekly-chart.component';
import { Progress, ProgressPort } from '../core/progress/progress.port';
import { WeekStat } from '../core/report/report.port';
import {
  EVOLUTION_MESSAGES,
  MIN_EVOLUTION_EXERCISES,
  ProgressPage,
  topicStars,
} from './progress.page';

const PROGRESS: Progress = {
  total: 4,
  correct: 3,
  streak: 2,
  dailyStreak: 3,
  practicedToday: true,
  byTopic: [{ topic: 'sumas_hasta_20', label: 'Sumas hasta 20', total: 4, correct: 3 }],
  recent: [
    { topic: 'sumas_hasta_20', label: 'Sumas hasta 20', correct: true, answeredAt: '2026-10-15' },
  ],
  weeks: [],
};

function setup(get: () => Promise<Progress>) {
  TestBed.configureTestingModule({
    declarations: [ProgressPage, MascotComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: ProgressPort, useValue: { get } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'perfil-1' } } } },
    ],
  });
  return TestBed.createComponent(ProgressPage).componentInstance;
}

describe('ProgressPage', () => {
  it('calcula el porcentaje y alegra a la mascota con buen resultado', async () => {
    const page = setup(async () => PROGRESS);
    await page.ngOnInit();
    expect(page.percent).toBe(75);
    expect(TestBed.inject(MascotPort).state()).toBe('happy');
  });

  it('sin intentos, porcentaje 0 y mascota en reposo', async () => {
    const page = setup(async () => ({ ...PROGRESS, total: 0, correct: 0, streak: 0, byTopic: [] }));
    await page.ngOnInit();
    expect(page.percent).toBe(0);
    expect(TestBed.inject(MascotPort).state()).toBe('idle');
  });

  it('si falla la carga, muestra un mensaje y no se rompe', async () => {
    const page = setup(async () => {
      throw new Error('x');
    });
    await page.ngOnInit();
    expect(page.error).toContain('No pude mostrar lo que avanzaste');
    expect(page.loading).toBe(false);
  });

  it('da estrellas por tema según el porcentaje', () => {
    expect(topicStars(0, 0)).toBe(0);
    expect(topicStars(49, 100)).toBe(0);
    expect(topicStars(50, 100)).toBe(1);
    expect(topicStars(75, 100)).toBe(2);
    expect(topicStars(99, 100)).toBe(2);
    expect(topicStars(4, 4)).toBe(3);
  });

  it('la racha de días anima a practicar hoy si aún no lo hizo', async () => {
    const page = setup(async () => ({ ...PROGRESS, dailyStreak: 2, practicedToday: false }));
    await page.ngOnInit();
    expect(page.dailyHint).toContain('seguir sumando');
  });

  it('sin racha de días invita a empezarla, también sin intentos', async () => {
    const page = setup(async () => ({
      ...PROGRESS, total: 0, correct: 0, streak: 0, dailyStreak: 0, practicedToday: false, byTopic: [],
    }));
    await page.ngOnInit();
    expect(page.dailyHint).toContain('empezar');
  });

  it('si ya practicó hoy no muestra frase extra', async () => {
    const page = setup(async () => PROGRESS);
    await page.ngOnInit();
    expect(page.dailyHint).toBe('');
  });
});

describe('ProgressPage: evolución (CU-A23)', () => {
  // Intentos en 3 semanas distintas (de la más antigua a la actual).
  const WEEKS: WeekStat[] = [
    { start: '2026-08-21', total: 0, correct: 0 },
    { start: '2026-08-28', total: 0, correct: 0 },
    { start: '2026-09-04', total: 4, correct: 2 },
    { start: '2026-09-11', total: 0, correct: 0 },
    { start: '2026-09-18', total: 0, correct: 0 },
    { start: '2026-09-25', total: 3, correct: 3 },
    { start: '2026-10-02', total: 0, correct: 0 },
    { start: '2026-10-09', total: 5, correct: 4 },
  ];

  function render(progress: Progress) {
    TestBed.configureTestingModule({
      declarations: [ProgressPage, MascotComponent, WeeklyChartComponent],
      imports: [IonicModule.forRoot()],
      providers: [
        { provide: MascotPort, useExisting: MascotService },
        { provide: ProgressPort, useValue: { get: async () => progress } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'perfil-1' } } } },
      ],
    });
    return TestBed.createComponent(ProgressPage);
  }

  async function load(progress: Progress) {
    const fixture = render(progress);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('con intentos en 3 semanas muestra las barras, la tabla accesible y el ánimo', async () => {
    const el = await load({ ...PROGRESS, total: 12, correct: 9, weeks: WEEKS });
    const chart = el.querySelector('[data-testid="evolution"] app-weekly-chart');
    expect(chart).not.toBeNull();
    // Una barra de ejercicios por cada semana con práctica (3), ninguna en las vacías.
    expect(chart?.querySelectorAll('rect.total').length).toBe(3);
    expect(chart?.querySelectorAll('rect.correct').length).toBe(3);
    // El % va escrito sobre cada barra: el gráfico no depende solo del color.
    const pct = Array.from(chart?.querySelectorAll('text.pct') ?? []).map((t) => t.textContent);
    expect(pct).toEqual(['–', '–', '50%', '–', '–', '100%', '–', '80%']);
    // Tabla para el lector de pantalla con las 8 semanas.
    const rows = Array.from(chart?.querySelectorAll('table tbody tr') ?? []).map((r) =>
      Array.from(r.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    );
    expect(rows).toHaveLength(8);
    // Fechas en palabras para el lector de pantalla y textos simples (modo niño del gráfico).
    expect(rows[2]).toEqual(['4 de septiembre', '4', '2']);
    expect(rows[7]).toEqual(['9 de octubre', '5', '4']);
    expect(chart?.querySelector('caption')?.textContent).toBe('Tus ejercicios por semana');
    expect(chart?.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'En las últimas 8 semanas hiciste 12 ejercicios. Esta semana hiciste 5 y te salieron bien 4.',
    );
    expect(chart?.textContent).not.toContain('respondidos');
    expect(chart?.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(el.querySelector('[data-testid="evolution-cheer"]')?.textContent).toContain(
      EVOLUTION_MESSAGES.cheer,
    );
    expect(el.querySelector('[data-testid="evolution-few"]')).toBeNull();
  });

  it('con 2 ejercicios muestra "aún hay pocos ejercicios" y no el gráfico', async () => {
    const weeks = WEEKS.map((w, i) => (i === 7 ? { ...w, total: 2, correct: 1 } : { ...w, total: 0, correct: 0 }));
    const el = await load({ ...PROGRESS, total: 2, correct: 1, weeks });
    expect(el.querySelector('app-weekly-chart')).toBeNull();
    expect(el.querySelector('[data-testid="evolution-few"]')?.textContent).toContain(
      'Aún hay pocos ejercicios para ver tu avance',
    );
  });

  it('desde 5 ejercicios en 8 semanas ya muestra el gráfico', async () => {
    const weeks = WEEKS.map((w, i) => (i === 7 ? { ...w, total: 5, correct: 1 } : { ...w, total: 0, correct: 0 }));
    const el = await load({ ...PROGRESS, total: 5, correct: 1, weeks });
    expect(el.querySelector('app-weekly-chart')).not.toBeNull();
    expect(MIN_EVOLUTION_EXERCISES).toBe(5);
  });

  it('sin intentos no muestra la sección (sigue el mensaje de siempre)', async () => {
    const el = await load({ ...PROGRESS, total: 0, correct: 0, streak: 0, byTopic: [], recent: [], weeks: [] });
    expect(el.querySelector('[data-testid="evolution"]')).toBeNull();
    expect(el.textContent).toContain('Todavía no hay intentos');
  });

  it('el texto no compara con otros niños', async () => {
    const el = await load({ ...PROGRESS, total: 12, correct: 9, weeks: WEEKS });
    const text = el.querySelector('[data-testid="evolution"]')?.textContent?.toLowerCase() ?? '';
    for (const word of ['otros', 'compañeros', 'promedio', 'mejor que', 'ranking']) {
      expect(text).not.toContain(word);
    }
  });
});
