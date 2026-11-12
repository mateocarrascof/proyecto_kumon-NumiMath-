import { NgModule } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CoreModule } from '../core.module';
import {
  CHART,
  WeeklyChartComponent,
  bars,
  percentLabel,
  shortDate,
  spokenDate,
} from './weekly-chart.component';

const WEEKS = [
  { start: '2026-09-01', total: 0, correct: 0 },
  { start: '2026-09-08', total: 10, correct: 5 },
  { start: '2026-09-15', total: 20, correct: 15 },
];

@NgModule({ imports: [CoreModule] })
class HostModule {}

describe('weekly chart', () => {
  it('formatea fechas y porcentajes', () => {
    expect(shortDate('2026-09-08')).toBe('8/9');
    expect(percentLabel({ start: '', total: 0, correct: 0 })).toBe('–');
    expect(percentLabel({ start: '', total: 20, correct: 15 })).toBe('75%');
  });

  it('la barra más alta llena el área y los aciertos son proporcionales', () => {
    const plotH = CHART.height - CHART.top - CHART.bottom;
    const [empty, half, full] = bars(WEEKS);
    expect(empty.totalH).toBe(0);
    expect(full.totalH).toBeCloseTo(plotH);
    expect(half.totalH).toBeCloseTo(plotH / 2);
    expect(half.correctH).toBeCloseTo(plotH / 4);
    expect(full.correctY).toBeGreaterThan(full.totalY);
    expect(half.x).toBeGreaterThan(empty.x);
  });

  it('no divide por cero sin datos', () => {
    expect(bars([{ start: '2026-09-01', total: 0, correct: 0 }])[0].totalH).toBe(0);
  });

  it('dibuja un resumen accesible y una tabla para lectores de pantalla', () => {
    TestBed.configureTestingModule({ imports: [HostModule] });
    const fixture = TestBed.createComponent(WeeklyChartComponent);
    fixture.componentRef.setInput('data', WEEKS);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const svg = el.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toContain('30 ejercicios');
    expect(svg?.getAttribute('aria-label')).toContain('75% de aciertos');
    expect(el.querySelectorAll('rect.total')).toHaveLength(2);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('el panel del tutor conserva sus textos', () => {
    TestBed.configureTestingModule({ imports: [HostModule] });
    const fixture = TestBed.createComponent(WeeklyChartComponent);
    fixture.componentRef.setInput('data', WEEKS);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.classList.contains('kid')).toBe(false);
    expect(el.querySelector('.legend')?.textContent).toContain('Ejercicios respondidos');
    expect(el.querySelector('tbody td')?.textContent).toBe('2026-09-01');
  });

  it('en modo niño usa textos simples y fechas en palabras', () => {
    TestBed.configureTestingModule({ imports: [HostModule] });
    const fixture = TestBed.createComponent(WeeklyChartComponent);
    fixture.componentRef.setInput('kid', true);
    fixture.componentRef.setInput('data', WEEKS);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.classList.contains('kid')).toBe(true);
    expect(el.querySelector('.legend')?.textContent).toContain('Bien hechos');
    expect(el.querySelector('.legend')?.textContent).not.toContain('respondidos');
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'En las últimas 3 semanas hiciste 30 ejercicios. Esta semana hiciste 20 y te salieron bien 15.',
    );
    expect(el.querySelector('tbody td')?.textContent).toBe('1 de septiembre');
  });

  it('lee las fechas en palabras', () => {
    expect(spokenDate('2026-10-20')).toBe('20 de octubre');
    expect(spokenDate('2026-01-05')).toBe('5 de enero');
    expect(spokenDate('raro')).toBe('raro');
  });
});
