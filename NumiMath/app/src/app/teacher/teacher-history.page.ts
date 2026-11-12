import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { HistoryItem, TeacherPort } from '../core/teacher/teacher.port';

const NOT_FOUND = 'No encontramos a ese alumno. Quizá el tutor quitó el vínculo.';

/** "2026-11-12" -> "12-11-2026" (solo el día, sin hora). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return y && m && d ? `${d}-${m}-${y}` : day;
}

/**
 * D7: historial de ejercicios de un alumno vinculado, desde que el tutor lo vinculó. Solo lectura:
 * fecha sin hora, sin duraciones y, en las tareas del tutor, sin su texto.
 */
@Component({
  selector: 'app-teacher-history',
  templateUrl: 'teacher-history.page.html',
  standalone: false,
})
export class TeacherHistoryPage implements OnInit {
  private readonly teacher = inject(TeacherPort);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  loading = true;
  loadingMore = false;
  error = '';
  studentId = '';
  items: HistoryItem[] = [];
  nextOffset: number | null = null;
  protected readonly formatDay = formatDay;

  async ngOnInit(): Promise<void> {
    this.studentId = this.route?.snapshot.paramMap.get('id') ?? '';
    await this.load(0);
    this.loading = false;
    this.cdr.markForCheck();
  }

  private async load(offset: number): Promise<void> {
    const result = await this.teacher.getHistory(this.studentId, offset);
    if (result.ok) {
      this.items = [...this.items, ...result.page.items];
      this.nextOffset = result.page.hasMore ? result.page.nextOffset : null;
    } else {
      this.error =
        result.reason === 'not_found' ? NOT_FOUND : 'No pude cargar el historial. Inténtalo de nuevo.';
      this.nextOffset = null;
    }
  }

  async more(): Promise<void> {
    if (this.nextOffset === null || this.loadingMore) return;
    this.loadingMore = true;
    await this.load(this.nextOffset);
    this.loadingMore = false;
    this.cdr.markForCheck();
  }
}
