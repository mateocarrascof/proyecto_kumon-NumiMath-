import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { WeekStat } from '../report/report.port';

export interface Bar {
  x: number;
  /** Alto total (intentos) y alto del tramo de aciertos, en unidades del SVG. */
  totalY: number;
  totalH: number;
  correctY: number;
  correctH: number;
  label: string;
  percent: string;
  week: WeekStat;
}

export const CHART = { width: 320, height: 190, top: 22, bottom: 26, left: 8, right: 8 };

/** "2026-10-20" → "20/10" (sin zona horaria: es una fecha de calendario). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${Number(d)}/${Number(m)}` : iso;
}

export function percentLabel(w: WeekStat): string {
  return w.total ? `${Math.round((100 * w.correct) / w.total)}%` : '–';
}

export function bars(weeks: WeekStat[]): Bar[] {
  const plotH = CHART.height - CHART.top - CHART.bottom;
  const slot = (CHART.width - CHART.left - CHART.right) / Math.max(weeks.length, 1);
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const base = CHART.top + plotH;
  return weeks.map((week, i) => {
    const totalH = (week.total / max) * plotH;
    const correctH = (week.correct / max) * plotH;
    return {
      x: CHART.left + i * slot + slot * 0.18,
      totalY: base - totalH,
      totalH,
      correctY: base - correctH,
      correctH,
      label: shortDate(week.start),
      percent: percentLabel(week),
      week,
    };
  });
}

/**
 * Barras por semana: alto = ejercicios respondidos; el tramo oscuro = aciertos; arriba, el %.
 * SVG propio (sin librerías). Accesible: resumen en aria-label y tabla para lectores de pantalla.
 */
@Component({
  selector: 'app-weekly-chart',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + chart.width + ' ' + chart.height"
      role="img"
      [attr.aria-label]="summary"
      preserveAspectRatio="xMidYMid meet"
    >
      <line
        class="axis"
        [attr.x1]="chart.left"
        [attr.x2]="chart.width - chart.right"
        [attr.y1]="chart.height - chart.bottom"
        [attr.y2]="chart.height - chart.bottom"
      />
      @for (b of items; track b.week.start) {
        <g>
          @if (b.week.total > 0) {
            <rect class="total" [attr.x]="b.x" [attr.y]="b.totalY" [attr.width]="barWidth" [attr.height]="b.totalH" rx="4" />
            <rect class="correct" [attr.x]="b.x" [attr.y]="b.correctY" [attr.width]="barWidth" [attr.height]="b.correctH" rx="4" />
          }
          <text class="pct" [attr.x]="b.x + barWidth / 2" [attr.y]="b.totalY - 6">{{ b.percent }}</text>
          <text class="day" [attr.x]="b.x + barWidth / 2" [attr.y]="chart.height - 8">{{ b.label }}</text>
        </g>
      }
    </svg>
    <div class="legend" aria-hidden="true">
      <span><i class="sw correct"></i> Aciertos</span>
      <span><i class="sw total"></i> Ejercicios respondidos</span>
    </div>
    <table class="sr-only">
      <caption>Ejercicios por semana</caption>
      <thead><tr><th scope="col">Semana desde</th><th scope="col">Ejercicios</th><th scope="col">Aciertos</th></tr></thead>
      <tbody>
        @for (w of weeks; track w.start) {
          <tr><td>{{ w.start }}</td><td>{{ w.total }}</td><td>{{ w.correct }}</td></tr>
        }
      </tbody>
    </table>
  `,
  styles: [
    `
      :host { display: block; }
      svg { width: 100%; height: auto; display: block; }
      .axis { stroke: var(--ion-color-medium); stroke-width: 1; }
      .total { fill: var(--kid-teal-soft); }
      .correct { fill: var(--ion-color-primary); }
      text { font: 700 10px var(--ion-font-family, sans-serif); text-anchor: middle; }
      .pct { fill: var(--ion-text-color); }
      .day { fill: var(--ion-color-medium-shade, #555); font-weight: 600; }
      .legend { display: flex; gap: 16px; justify-content: center; font-size: 0.85rem; margin-top: 4px; }
      .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; }
      .sw.total { background: var(--kid-teal-soft); }
      .sw.correct { background: var(--ion-color-primary); }
    `,
  ],
})
export class WeeklyChartComponent {
  protected readonly chart = CHART;
  items: Bar[] = [];
  weeks: WeekStat[] = [];
  barWidth = 0;
  summary = '';

  @Input({ required: true })
  set data(weeks: WeekStat[]) {
    this.weeks = weeks;
    this.items = bars(weeks);
    const slot = (CHART.width - CHART.left - CHART.right) / Math.max(weeks.length, 1);
    this.barWidth = slot * 0.64;
    const total = weeks.reduce((n, w) => n + w.total, 0);
    const last = weeks.at(-1);
    this.summary =
      `Gráfico de las últimas ${weeks.length} semanas: ${total} ejercicios en total. ` +
      (last?.total
        ? `Esta semana: ${last.total} ejercicios, ${percentLabel(last)} de aciertos.`
        : 'Esta semana aún no hay ejercicios.');
  }
}
