import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { WeeklyChartComponent } from '../core/charts/weekly-chart.component';
import { WeekStat } from '../core/report/report.port';
import { EvolutionResult, TeacherPort } from '../core/teacher/teacher.port';
import { TeacherEvolutionPage } from './teacher-evolution.page';

const weeks = (totals: number[]): WeekStat[] =>
  totals.map((total, i) => ({ start: `2026-10-${String(5 + 7 * i).padStart(2, '0')}`, total, correct: total - 1 }));

async function render(result: EvolutionResult) {
  TestBed.configureTestingModule({
    declarations: [TeacherEvolutionPage, WeeklyChartComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: TeacherPort, useValue: { getEvolution: vi.fn(async () => result) } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'perfil-1']]) } } },
    ],
  });
  const fixture = TestBed.createComponent(TeacherEvolutionPage);
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('TeacherEvolutionPage (D6)', () => {
  it('dibuja el gráfico de las semanas con su tabla accesible', async () => {
    const el = await render({ ok: true, weeks: weeks([0, 2, 3, 4, 5, 6, 7, 8]) });
    expect(el.querySelector('app-weekly-chart svg')).not.toBeNull();
    expect(el.querySelector('app-weekly-chart table')).not.toBeNull();
    expect(el.querySelector('[data-testid="evolution-few"]')).toBeNull();
  });

  it('con muy pocos ejercicios dice que aún no hay conclusiones', async () => {
    const el = await render({ ok: true, weeks: weeks([0, 0, 0, 0, 0, 1, 1, 0]) });
    expect(el.querySelector('[data-testid="evolution-few"]')?.textContent).toContain(
      'Aún hay pocos ejercicios para sacar conclusiones',
    );
  });

  it('sin vínculo (404) dice lo mismo que si el alumno no existiera', async () => {
    const el = await render({ ok: false, reason: 'not_found' });
    expect(el.querySelector('[data-testid="evolution-error"]')?.textContent).toContain('No encontramos a ese alumno');
    expect(el.querySelector('app-weekly-chart')).toBeNull();
  });
});
