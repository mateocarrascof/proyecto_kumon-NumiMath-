import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { SheetDetail, SheetItem, TeacherPort } from '../core/teacher/teacher.port';
import { formatDay } from './teacher-history.page';

const NOT_FOUND = 'No encontramos a ese alumno. Quizá el tutor quitó el vínculo.';

/**
 * D8: hojas de cálculo guardadas de un alumno vinculado, desde que el tutor lo vinculó. Solo lectura:
 * se ven los trazos sobre la cuadrícula del papel, la respuesta del niño y la correcta.
 */
@Component({
  selector: 'app-teacher-sheets',
  templateUrl: 'teacher-sheets.page.html',
  standalone: false,
})
export class TeacherSheetsPage implements OnInit {
  private readonly teacher = inject(TeacherPort);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  loading = true;
  loadingMore = false;
  error = '';
  studentId = '';
  items: SheetItem[] = [];
  nextOffset: number | null = null;
  opened: SheetDetail | null = null;
  openError = '';
  protected readonly formatDay = formatDay;

  async ngOnInit(): Promise<void> {
    this.studentId = this.route?.snapshot.paramMap.get('id') ?? '';
    await this.load(0);
    this.loading = false;
    this.cdr.markForCheck();
  }

  private async load(offset: number): Promise<void> {
    const result = await this.teacher.listSheets(this.studentId, offset);
    if (result.ok) {
      this.items = [...this.items, ...result.page.items];
      this.nextOffset = result.page.hasMore ? result.page.nextOffset : null;
    } else {
      this.error =
        result.reason === 'not_found' ? NOT_FOUND : 'No pude cargar las hojas. Inténtalo de nuevo.';
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

  async open(item: SheetItem): Promise<void> {
    this.openError = '';
    const result = await this.teacher.getSheet(this.studentId, item.id);
    if (result.ok) {
      this.opened = result.sheet;
    } else {
      this.opened = null;
      this.openError =
        result.reason === 'not_found' ? NOT_FOUND : 'No pude abrir la hoja. Inténtalo de nuevo.';
    }
    this.cdr.markForCheck();
  }

  close(): void {
    this.opened = null;
  }
}
