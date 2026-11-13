import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { KID_ERRORS } from '../core/kid-messages';
import { pickPhrase } from '../core/mascot/mascot-phrases';
import { MascotPort } from '../core/mascot/mascot.port';
import { PracticeError } from '../core/practice/practice.port';
import { dailyStreakHint, daysLabel } from '../core/progress/daily-streak';
import { Progress, ProgressPort } from '../core/progress/progress.port';

const MESSAGES: Record<string, string> = {
  ...KID_ERRORS,
  unavailable: 'No pude mostrar lo que avanzaste. Intenta en un momento.',
};

/** Estrellas de un tema (0 a 3) según el porcentaje de aciertos. */
export function topicStars(correct: number, total: number): number {
  if (total <= 0) return 0;
  const pct = (correct / total) * 100;
  if (pct >= 100) return 3;
  if (pct >= 75) return 2;
  if (pct >= 50) return 1;
  return 0;
}

/** Racha que muestra la insignia en el resumen. */
export const STREAK_BADGE = 5;

/**
 * CU-A23: con menos de 5 ejercicios en las últimas 8 semanas no se dibuja el gráfico (no se ve
 * ninguna evolución y unas barras casi vacías podrían desanimar). Misma regla de "pocos datos"
 * que el informe del tutor.
 */
export const MIN_EVOLUTION_EXERCISES = 5;

export const EVOLUTION_MESSAGES = {
  /**
   * Para el niño (6–7 años): la acción primero, sin "mínimo" ni "evolución". `missing` y `weeks`
   * salen de la misma regla que decide si se muestra el gráfico (suma de `progress.weeks`), y el
   * texto dice esa ventana para que no choque con el total de siempre.
   */
  few: (missing: number, weeks: number): string => {
    const action = missing === 1 ? '¡Haz 1 ejercicio más' : `¡Haz ${missing} ejercicios más`;
    const window =
      weeks === 1 ? 'de esta semana' : weeks > 1 ? `de las últimas ${weeks} semanas` : 'de las últimas semanas';
    return `${action} y verás tu avance! Aquí cuentan los ejercicios ${window}.`;
  },
  cheer: '¡Cada semana que practicas, aprendes más!',
} as const;

@Component({
  selector: 'app-progress',
  templateUrl: 'progress.page.html',
  styleUrls: ['progress.page.scss'],
  standalone: false,
})
export class ProgressPage implements OnInit {
  private readonly progressPort = inject(ProgressPort);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly mascot = inject(MascotPort);

  studentId = '';
  progress: Progress | null = null;
  loading = true;
  error = '';
  message = '';
  protected readonly topicStars = topicStars;
  protected readonly starSlots = [0, 1, 2];
  protected readonly streakBadge = STREAK_BADGE;
  protected readonly daysLabel = daysLabel;
  protected readonly evolutionMessages = EVOLUTION_MESSAGES;

  /** Ejercicios de las últimas 8 semanas (solo práctica: el diagnóstico no cuenta). */
  get weeksTotal(): number {
    return (this.progress?.weeks ?? []).reduce((n, w) => n + w.total, 0);
  }

  /** Ejercicios que faltan para ver el gráfico (0 si ya se muestra). */
  get missingExercises(): number {
    return Math.max(0, MIN_EVOLUTION_EXERCISES - this.weeksTotal);
  }

  get showEvolution(): boolean {
    return this.weeksTotal >= MIN_EVOLUTION_EXERCISES;
  }

  get dailyHint(): string {
    const p = this.progress;
    return p ? dailyStreakHint(p.dailyStreak, p.practicedToday) : '';
  }

  get percent(): number {
    const p = this.progress;
    return p && p.total > 0 ? Math.round((p.correct / p.total) * 100) : 0;
  }

  ratio(correct: number, total: number): number {
    return total > 0 ? correct / total : 0;
  }

  async ngOnInit(): Promise<void> {
    this.studentId = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      this.progress = await this.progressPort.get(this.studentId);
      this.message = this.progress.total > 0 ? pickPhrase('progress') : pickPhrase('greet');
      this.mascot.set(this.progress.total > 0 && this.percent >= 70 ? 'happy' : 'idle');
    } catch (error) {
      this.error = MESSAGES[error instanceof PracticeError ? error.code : 'unavailable'] ?? MESSAGES['unavailable'];
      this.mascot.set('sad');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }
}
