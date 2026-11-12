import { ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

import { ParentalPort } from '../core/parental/parental.port';
import {
  LinkFailure,
  LinkTerms,
  LinkedTeacher,
  TeacherLinksPort,
} from '../core/teacher-links/teacher-links.port';
import { LegalBlock, parseLegalText } from '../core/legal/legal-text';
import { pinMessage } from './tutor-panel.page';

export const CODE_LENGTH = 8;

function lockMessage(seconds: number | undefined): string {
  const minutes = seconds ? Math.max(1, Math.ceil(seconds / 60)) : 15;
  return `Demasiados intentos con códigos que no existen. Espera ${minutes} minutos.`;
}

function failureMessage(reason: LinkFailure, retryAfterSeconds?: number): string {
  switch (reason) {
    case 'not_found':
      return 'No encontramos un docente con ese código. Revisa el código e inténtalo de nuevo.';
    case 'locked':
      return lockMessage(retryAfterSeconds);
    case 'already_linked':
      return 'Ese docente ya está vinculado a este perfil.';
    case 'expired':
      return 'La confirmación venció o cambió. Vuelve a ingresar el código del docente.';
    case 'pin':
      return 'Tu PIN venció. Escríbelo otra vez.';
    case 'consent':
      return 'Para vincular a un docente necesitas el consentimiento vigente.';
    case 'forbidden':
      return 'No tienes acceso a este perfil.';
    case 'network':
      return 'No pude conectar con el servidor.';
    default:
      return 'No pude completar la operación. Inténtalo en un momento.';
  }
}

type Step = 'idle' | 'code' | 'notice';

/**
 * Docentes vinculados a UN hijo (T25 y T26). Vincular y quitar piden el PIN otra vez, siempre; el
 * texto de autorización se muestra completo con el nombre del docente y solo se puede aceptar si su
 * huella coincide con la publicada.
 */
@Component({
  selector: 'app-teacher-links',
  templateUrl: 'teacher-links.component.html',
  standalone: false,
})
export class TeacherLinksComponent implements OnChanges {
  private readonly links = inject(TeacherLinksPort);
  private readonly parental = inject(ParentalPort);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input({ required: true }) studentId = '';
  @Input() nickname = '';

  teachers: LinkedTeacher[] = [];
  listError = '';
  ok = '';

  step: Step = 'idle';
  pin = '';
  code = '';
  busy = false;
  error = '';

  // Paso "aviso"
  teacherName = '';
  terms: LinkTerms | null = null;
  blocks: LegalBlock[] = [];
  textVerified = false;
  accepted = false;
  private token = '';

  // Quitar
  removing: LinkedTeacher | null = null;
  removePin = '';
  removeBusy = false;
  removeError = '';

  protected readonly codeLength = CODE_LENGTH;

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['studentId']) {
      this.reset();
      this.ok = '';
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.listError = '';
    if (!this.studentId) return;
    const result = await this.links.list(this.studentId);
    if (result.ok) this.teachers = result.teachers;
    else this.listError = 'No pude cargar los docentes vinculados.';
    this.cdr.markForCheck();
  }

  private reset(): void {
    this.step = 'idle';
    this.pin = '';
    this.code = '';
    this.error = '';
    this.token = '';
    this.terms = null;
    this.blocks = [];
    this.accepted = false;
    this.removing = null;
    this.removePin = '';
    this.removeError = '';
  }

  onPin(value: string | null | undefined): void {
    this.pin = (value ?? '').replace(/\D/g, '').slice(0, 4);
    this.cdr.markForCheck();
  }

  onRemovePin(value: string | null | undefined): void {
    this.removePin = (value ?? '').replace(/\D/g, '').slice(0, 4);
    this.cdr.markForCheck();
  }

  onCode(value: string | null | undefined): void {
    this.code = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
    this.cdr.markForCheck();
  }

  get canSearch(): boolean {
    return this.pin.length === 4 && this.code.length === CODE_LENGTH && !this.busy;
  }

  startLink(): void {
    this.reset();
    this.ok = '';
    this.step = 'code';
    this.cdr.markForCheck();
  }

  cancel(): void {
    this.reset();
    this.cdr.markForCheck();
  }

  /** Verifica el PIN (siempre, de nuevo) y busca al docente. */
  async search(): Promise<void> {
    if (!this.canSearch) return;
    this.busy = true;
    this.error = '';
    try {
      await this.parental.verify(this.pin);
    } catch (error) {
      this.pin = '';
      this.error = pinMessage(error);
      this.busy = false;
      this.cdr.markForCheck();
      return;
    }
    this.pin = '';
    const result = await this.links.lookup(this.studentId, this.code);
    if (!result.ok) {
      this.error = failureMessage(result.reason, result.retryAfterSeconds);
      this.busy = false;
      this.cdr.markForCheck();
      return;
    }
    try {
      const loaded = await this.links.loadAuthorizationText(result.terms.sha256);
      this.blocks = parseLegalText(loaded.text);
      this.textVerified = loaded.verified;
    } catch {
      this.blocks = [];
      this.textVerified = false;
    }
    this.teacherName = result.teacherName;
    this.terms = result.terms;
    this.token = result.confirmationToken;
    this.accepted = false;
    this.code = '';
    this.step = 'notice';
    this.busy = false;
    this.cdr.markForCheck();
  }

  get canConfirm(): boolean {
    return this.step === 'notice' && this.textVerified && this.accepted && !this.busy;
  }

  async confirm(): Promise<void> {
    if (!this.canConfirm) return;
    this.busy = true;
    this.error = '';
    const result = await this.links.create(this.studentId, this.token);
    this.busy = false;
    if (result.ok) {
      this.ok = `Vinculaste a ${result.teacherName} con ${this.nickname}.`;
      this.reset();
      await this.load();
    } else {
      this.error = failureMessage(result.reason);
      if (result.reason === 'expired' || result.reason === 'already_linked') this.step = 'code';
    }
    this.cdr.markForCheck();
  }

  askRemove(teacher: LinkedTeacher): void {
    this.removing = teacher;
    this.removePin = '';
    this.removeError = '';
    this.ok = '';
    this.cdr.markForCheck();
  }

  cancelRemove(): void {
    this.removing = null;
    this.removePin = '';
    this.removeError = '';
    this.cdr.markForCheck();
  }

  /** Quitar pide el PIN de nuevo y no borra nada del niño ni sus hojas. */
  async confirmRemove(): Promise<void> {
    const target = this.removing;
    if (!target || this.removeBusy || this.removePin.length !== 4) return;
    this.removeBusy = true;
    this.removeError = '';
    try {
      await this.parental.verify(this.removePin);
    } catch (error) {
      this.removePin = '';
      this.removeError = pinMessage(error);
      this.removeBusy = false;
      this.cdr.markForCheck();
      return;
    }
    this.removePin = '';
    const result = await this.links.remove(this.studentId, target.teacherId);
    this.removeBusy = false;
    if (result.ok || (!result.ok && result.reason === 'not_found')) {
      this.removing = null;
      this.ok = `${target.name} ya no está vinculado a ${this.nickname}.`;
      await this.load();
    } else {
      this.removeError = failureMessage(result.reason);
    }
    this.cdr.markForCheck();
  }
}
