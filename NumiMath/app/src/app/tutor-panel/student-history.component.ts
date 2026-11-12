import { ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

import { AttemptEntry, HistoryPort } from '../core/history/history.port';

/** "2026-11-12T15:30:00Z" -> hora local de Chile, "12-11-2026 12:30". */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** T5: historial de ejercicios del hijo seleccionado (habilidad, resultado, nivel y hora), paginado. */
@Component({
  selector: 'app-student-history',
  templateUrl: 'student-history.component.html',
  standalone: false,
})
export class StudentHistoryComponent implements OnChanges {
  private readonly history = inject(HistoryPort);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input({ required: true }) studentId = '';
  @Input() nickname = '';

  loading = false;
  loadingMore = false;
  error = '';
  items: AttemptEntry[] = [];
  nextOffset: number | null = null;
  protected readonly formatWhen = formatWhen;

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!changes['studentId']) return;
    this.items = [];
    this.nextOffset = null;
    this.error = '';
    if (!this.studentId) return;
    this.loading = true;
    await this.load(0);
    this.loading = false;
    this.cdr.markForCheck();
  }

  private async load(offset: number): Promise<void> {
    const result = await this.history.page(this.studentId, offset);
    if (result.ok) {
      this.items = [...this.items, ...result.page.items];
      this.nextOffset = result.page.hasMore ? result.page.nextOffset : null;
    } else {
      this.error =
        result.reason === 'pin'
          ? 'Tu PIN venció. Sal del panel y vuelve a entrar.'
          : 'No pude cargar el historial. Inténtalo en un momento.';
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
