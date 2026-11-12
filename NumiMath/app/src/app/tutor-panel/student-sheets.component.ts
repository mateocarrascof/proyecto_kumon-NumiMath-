import { ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

import { ParentalPort } from '../core/parental/parental.port';
import {
  TutorSheetDetail,
  TutorSheetItem,
  TutorSheetsFailure,
  TutorSheetsPort,
} from '../core/sheets/tutor-sheets.port';
import { formatWhen } from './student-history.component';
import { pinMessage } from './tutor-panel.page';

function failureMessage(reason: TutorSheetsFailure): string {
  switch (reason) {
    case 'pin':
      return 'Tu PIN venció. Escríbelo otra vez.';
    case 'not_found':
      return 'Esa hoja ya no existe.';
    case 'network':
      return 'No pude conectar con el servidor.';
    case 'forbidden':
      return 'No tienes acceso a este perfil.';
    default:
      return 'No pude completar la operación. Inténtalo en un momento.';
  }
}

/** Qué se está confirmando: borrar una hoja o todas las del perfil. */
type Confirm = { kind: 'one'; item: TutorSheetItem } | { kind: 'all' };

/**
 * T27: hojas guardadas del hijo seleccionado. El tutor las ve (lista con fecha, ejercicio y resultado;
 * cada hoja se dibuja con el mismo visor del docente) y puede borrar una o todas. Borrar es definitivo,
 * el docente deja de verlas de inmediato y SIEMPRE pide el PIN de nuevo, además de la confirmación.
 */
@Component({
  selector: 'app-student-sheets',
  templateUrl: 'student-sheets.component.html',
  standalone: false,
})
export class StudentSheetsComponent implements OnChanges {
  private readonly sheets = inject(TutorSheetsPort);
  private readonly parental = inject(ParentalPort);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input({ required: true }) studentId = '';
  @Input() nickname = '';

  loading = false;
  loadingMore = false;
  error = '';
  notice = '';
  items: TutorSheetItem[] = [];
  total = 0;
  nextOffset: number | null = null;

  opened: TutorSheetDetail | null = null;
  openError = '';

  confirming: Confirm | null = null;
  pin = '';
  busy = false;
  confirmError = '';

  protected readonly formatWhen = formatWhen;

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!changes['studentId']) return;
    this.items = [];
    this.total = 0;
    this.nextOffset = null;
    this.error = '';
    this.notice = '';
    this.opened = null;
    this.cancelConfirm();
    if (!this.studentId) return;
    this.loading = true;
    await this.load(0);
    this.loading = false;
    this.cdr.markForCheck();
  }

  private async load(offset: number): Promise<void> {
    const result = await this.sheets.list(this.studentId, offset);
    if (result.ok) {
      this.items = offset === 0 ? result.page.items : [...this.items, ...result.page.items];
      this.total = result.page.total;
      this.nextOffset = result.page.hasMore ? result.page.nextOffset : null;
    } else {
      this.error =
        result.reason === 'pin'
          ? 'Tu PIN venció. Sal del panel y vuelve a entrar.'
          : 'No pude cargar las hojas. Inténtalo en un momento.';
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

  async open(item: TutorSheetItem): Promise<void> {
    this.openError = '';
    const result = await this.sheets.get(this.studentId, item.id);
    if (result.ok) {
      this.opened = result.sheet;
    } else {
      this.opened = null;
      this.openError = failureMessage(result.reason);
    }
    this.cdr.markForCheck();
  }

  close(): void {
    this.opened = null;
  }

  askRemove(item: TutorSheetItem): void {
    this.confirming = { kind: 'one', item };
    this.resetPin();
    this.notice = '';
    this.cdr.markForCheck();
  }

  askRemoveAll(): void {
    this.confirming = { kind: 'all' };
    this.resetPin();
    this.notice = '';
    this.cdr.markForCheck();
  }

  cancelConfirm(): void {
    this.confirming = null;
    this.resetPin();
    this.cdr.markForCheck();
  }

  private resetPin(): void {
    this.pin = '';
    this.confirmError = '';
  }

  onPin(value: string | null | undefined): void {
    this.pin = (value ?? '').replace(/\D/g, '').slice(0, 4);
  }

  /** Borrar pide el PIN de nuevo (recién verificado); no se puede deshacer. */
  async confirmRemove(): Promise<void> {
    const target = this.confirming;
    if (!target || this.busy || this.pin.length !== 4) return;
    this.busy = true;
    this.confirmError = '';
    try {
      await this.parental.verify(this.pin);
    } catch (error) {
      this.pin = '';
      this.confirmError = pinMessage(error);
      this.busy = false;
      this.cdr.markForCheck();
      return;
    }
    this.pin = '';
    const result =
      target.kind === 'one'
        ? await this.sheets.remove(this.studentId, target.item.id)
        : await this.sheets.removeAll(this.studentId);
    this.busy = false;
    if (result.ok || result.reason === 'not_found') {
      this.confirming = null;
      this.opened = null;
      this.notice =
        target.kind === 'one'
          ? 'La hoja se borró.'
          : result.ok && result.deleted === 1
            ? 'Se borró 1 hoja.'
            : `Se borraron ${result.ok ? result.deleted : 0} hojas.`;
      await this.load(0);
    } else {
      this.confirmError = failureMessage(result.reason);
    }
    this.cdr.markForCheck();
  }
}
