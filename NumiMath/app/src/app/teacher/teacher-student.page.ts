import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import { SkillState, StudentProgress, TeacherPort } from '../core/teacher/teacher.port';

export const MAX_LEVEL = 3;
export const BLOCK_SIZE = 10;

const NOT_FOUND = 'No encontramos a ese alumno. Quizá el tutor quitó el vínculo.';

/** D5: estado actual por habilidad de un alumno vinculado. Solo lectura, sin tiempos ni racha. */
@Component({
  selector: 'app-teacher-student',
  templateUrl: 'teacher-student.page.html',
  standalone: false,
})
export class TeacherStudentPage implements OnInit {
  private readonly teacher = inject(TeacherPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  loading = true;
  error = '';
  studentId = '';
  progress: StudentProgress | null = null;

  async ngOnInit(): Promise<void> {
    this.studentId = this.route?.snapshot.paramMap.get('id') ?? '';
    const result = await this.teacher.getProgress(this.studentId);
    this.loading = false;
    if (result.ok) this.progress = result.progress;
    else this.error = result.reason === 'not_found' ? NOT_FOUND : 'No pude cargar el progreso. Inténtalo de nuevo.';
    this.cdr.markForCheck();
  }

  /** Estrellas del nivel (1 a 3) como texto accesible. */
  stars(skill: SkillState): string {
    return skill.mastered ? 'Dominada' : `Nivel ${skill.level} de ${MAX_LEVEL}`;
  }

  async openHistory(): Promise<void> {
    await this.nav.navigateForward(`/docente/alumnos/${this.studentId}/historial`);
  }

  async openEvolution(): Promise<void> {
    await this.nav.navigateForward(`/docente/alumnos/${this.studentId}/evolucion`);
  }

  async openSheets(): Promise<void> {
    await this.nav.navigateForward(`/docente/alumnos/${this.studentId}/hojas`);
  }
}
