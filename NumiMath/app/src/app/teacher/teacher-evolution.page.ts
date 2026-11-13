import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { WeekStat } from '../core/report/report.port';
import { TeacherPort } from '../core/teacher/teacher.port';

const NOT_FOUND = 'No encontramos a ese alumno. Quizá el tutor quitó el vínculo.';
/** Con menos ejercicios en total no se sacan conclusiones. */
export const MIN_EXERCISES = 5;

/** D6: ejercicios y aciertos por semana (8 semanas) de un alumno vinculado, desde el vínculo. */
@Component({
  selector: 'app-teacher-evolution',
  templateUrl: 'teacher-evolution.page.html',
  standalone: false,
})
export class TeacherEvolutionPage implements OnInit {
  private readonly teacher = inject(TeacherPort);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  loading = true;
  error = '';
  studentId = '';
  weeks: WeekStat[] = [];

  get total(): number {
    return this.weeks.reduce((n, w) => n + w.total, 0);
  }

  get fewExercises(): boolean {
    return this.total < MIN_EXERCISES;
  }

  /** "Aún hay pocos ejercicios. Faltan N para ver la evolución (mínimo 5)." (singular con 1). */
  get fewMessage(): string {
    const missing = Math.max(0, MIN_EXERCISES - this.total);
    const count = missing === 1 ? 'Falta 1' : `Faltan ${missing}`;
    return `Aún hay pocos ejercicios. ${count} para ver la evolución (mínimo ${MIN_EXERCISES}).`;
  }

  async ngOnInit(): Promise<void> {
    this.studentId = this.route?.snapshot.paramMap.get('id') ?? '';
    const result = await this.teacher.getEvolution(this.studentId);
    this.loading = false;
    if (result.ok) this.weeks = result.weeks;
    else
      this.error =
        result.reason === 'not_found' ? NOT_FOUND : 'No pude cargar la evolución. Inténtalo de nuevo.';
    this.cdr.markForCheck();
  }
}
