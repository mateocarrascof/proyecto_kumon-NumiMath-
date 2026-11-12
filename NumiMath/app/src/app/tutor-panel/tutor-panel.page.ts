import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import {
  Assignment,
  AssignmentsPort,
  TutorError,
} from '../core/assignments/assignments.port';
import { requestPersistentStorage } from '../core/offline/persistent-storage';
import { ParentalSession } from '../core/parental/parental-session';
import { ParentalPort, PinError } from '../core/parental/parental.port';
import { Avatar, avatarFor } from '../core/profiles/avatar';
import { MAX_PROFILES, Profile, ProfilesPort } from '../core/profiles/profiles.port';
import { FeedbackKind, Report, ReportPort } from '../core/report/report.port';
import { formatDuration } from '../core/time/format-duration';

export const MAX_PENDING = 20;
export const TEXT_MAX = 200;

const ERRORS: Record<string, string> = {
  session: 'Tu sesión no es válida, vuelve a iniciar sesión.',
  forbidden: 'No tienes acceso a este perfil.',
  network: 'No pude conectar con el servidor.',
  unavailable: 'No pude cargar los datos. Inténtalo en un momento.',
  not_found: 'Esa tarea ya no se puede borrar (quizás ya la respondió).',
};

const FEEDBACK_ICONS: Record<FeedbackKind, string> = {
  info: 'ℹ️',
  strength: '💪',
  improve: '🎯',
  habit: '📅',
  trend: '📈',
};

/**
 * Panel del tutor (zona protegida con PIN): pestañas por perfil, informe con gráfico y feedback,
 * ejercicios propios ("tareas") y gestión de perfiles (crear y eliminar; eliminar pide el PIN
 * otra vez). Si el servidor dice que el PIN venció, vuelve a /pin.
 */
@Component({
  selector: 'app-tutor-panel',
  templateUrl: 'tutor-panel.page.html',
  styleUrls: ['tutor-panel.page.scss'],
  standalone: false,
})
export class TutorPanelPage implements OnInit {
  private readonly reports = inject(ReportPort);
  private readonly assignments = inject(AssignmentsPort);
  private readonly profilesPort = inject(ProfilesPort);
  private readonly session = inject(ParentalSession);
  private readonly parental = inject(ParentalPort);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);

  profiles: Profile[] = [];
  studentId = '';
  loading = true;
  profilesError = '';
  report: Report | null = null;
  reportError = '';
  tasks: Assignment[] = [];
  tasksError = '';

  text = '';
  answer = '';
  saving = false;
  formError = '';
  formOk = '';
  protected readonly textMax = TEXT_MAX;
  protected readonly maxPending = MAX_PENDING;
  protected readonly maxProfiles = MAX_PROFILES;
  protected readonly formatDuration = formatDuration;

  // Gestión de perfiles
  showProfileForm = false;
  /** Perfil que se va a eliminar (pide el PIN otra vez). */
  deleting: Profile | null = null;
  deletePin = '';
  deleteBusy = false;
  deleteError = '';
  profilesOk = '';

  avatar(p: Profile): Avatar {
    return avatarFor(p.id);
  }

  /** Apodo del perfil seleccionado (para los textos de la sección de docentes). */
  get selectedNickname(): string {
    return this.profiles.find((p) => p.id === this.studentId)?.nickname ?? '';
  }

  get profilesFull(): boolean {
    return this.profiles.length >= MAX_PROFILES;
  }

  get pendingCount(): number {
    return this.tasks.filter((t) => t.status === 'pending').length;
  }

  get full(): boolean {
    return this.pendingCount >= MAX_PENDING;
  }

  get canSave(): boolean {
    return !this.saving && !this.full && this.text.trim().length > 0 && this.answer.length > 0;
  }

  icon(kind: FeedbackKind): string {
    return FEEDBACK_ICONS[kind] ?? 'ℹ️';
  }

  async ngOnInit(): Promise<void> {
    // CU-A12: pedir que el navegador no borre la cola sin conexión. Aquí, en la zona del tutor,
    // porque el navegador puede mostrar un diálogo que un niño no debe ver.
    void requestPersistentStorage();
    await this.loadProfiles();
    this.loading = false;
    this.cdr.markForCheck();
  }

  /** Lee los perfiles y mantiene el elegido si sigue existiendo. */
  private async loadProfiles(): Promise<void> {
    try {
      this.profiles = await this.profilesPort.list();
      this.profilesError = '';
    } catch {
      this.profilesError = 'No pude cargar los perfiles.';
    }
    const keep = this.profiles.find((p) => p.id === this.studentId) ?? this.profiles[0];
    if (keep) {
      if (keep.id !== this.studentId) await this.select(keep.id);
    } else {
      this.studentId = '';
      this.report = null;
      this.tasks = [];
    }
  }

  async onProfileCreated(profile: Profile): Promise<void> {
    this.showProfileForm = false;
    this.profilesOk = `Perfil de ${profile.nickname} creado.`;
    await this.loadProfiles();
    await this.select(profile.id);
    this.cdr.markForCheck();
  }

  openProfileForm(): void {
    this.showProfileForm = true;
    this.profilesOk = '';
  }

  askDelete(profile: Profile): void {
    this.deleting = profile;
    this.deletePin = '';
    this.deleteError = '';
    this.profilesOk = '';
  }

  cancelDelete(): void {
    this.deleting = null;
    this.deletePin = '';
    this.deleteError = '';
  }

  onDeletePin(value: string | null | undefined): void {
    this.deletePin = (value ?? '').replace(/\D/g, '').slice(0, 4);
  }

  /** Eliminar: primero se verifica el PIN otra vez; luego la API borra (con el token nuevo). */
  async confirmDelete(): Promise<void> {
    const target = this.deleting;
    if (!target || this.deleteBusy || this.deletePin.length !== 4) return;
    this.deleteBusy = true;
    this.deleteError = '';
    try {
      await this.parental.verify(this.deletePin);
    } catch (error) {
      this.deletePin = '';
      this.deleteError = pinMessage(error);
      this.deleteBusy = false;
      this.cdr.markForCheck();
      return;
    }
    const result = await this.profilesPort.remove(target.id);
    this.deleteBusy = false;
    if (result === 'ok' || result === 'not_found') {
      this.deleting = null;
      this.deletePin = '';
      this.profilesOk = `Se eliminó el perfil de ${target.nickname} y todos sus datos.`;
      await this.loadProfiles();
    } else if (result === 'pin') {
      this.deleteError = 'Tu PIN venció. Escríbelo otra vez.';
      this.deletePin = '';
    } else {
      this.deleteError = 'No pude eliminar el perfil. Inténtalo en un momento.';
    }
    this.cdr.markForCheck();
  }

  /** Cambia de niño: limpia y recarga informe y tareas. */
  async select(id: string | null | undefined): Promise<void> {
    if (!id || !this.profiles.some((p) => p.id === id)) return;
    this.studentId = id;
    this.report = null;
    this.tasks = [];
    this.reportError = this.tasksError = this.formError = this.formOk = '';
    this.text = this.answer = '';
    this.cdr.markForCheck();
    await Promise.all([this.loadReport(), this.loadTasks()]);
    this.cdr.markForCheck();
  }

  changePin(): Promise<boolean> {
    return this.nav.navigateForward('/pin', { queryParams: { cambiar: '1' } });
  }

  /** Cierra la zona del tutor: borra el token del PIN. */
  exit(): Promise<boolean> {
    this.session.end();
    return this.nav.navigateRoot('/home');
  }

  onText(value: string | null | undefined): void {
    this.text = (value ?? '').slice(0, TEXT_MAX);
    this.formOk = '';
  }

  onAnswer(value: string | null | undefined): void {
    this.answer = (value ?? '').replace(/\D/g, '').slice(0, 7);
    this.formOk = '';
  }

  async save(): Promise<void> {
    if (!this.canSave) return;
    this.saving = true;
    this.formError = '';
    this.formOk = '';
    try {
      await this.assignments.create(this.studentId, this.text.trim(), Number(this.answer));
      this.text = '';
      this.answer = '';
      this.formOk = 'Tarea guardada. Aparecerá en la práctica del niño.';
      await this.loadTasks();
    } catch (error) {
      this.formError = this.message(error);
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  // T8: editar una tarea pendiente. Pide el PIN de nuevo (el servidor exige que sea reciente).
  editing: Assignment | null = null;
  editText = '';
  editAnswer = '';
  editPin = '';
  editBusy = false;
  editError = '';

  startEdit(task: Assignment): void {
    if (task.status !== 'pending') return;
    this.editing = task;
    this.editText = task.text;
    this.editAnswer = String(task.answer);
    this.editPin = '';
    this.editError = '';
  }

  cancelEdit(): void {
    this.editing = null;
    this.editPin = '';
    this.editError = '';
  }

  get canSaveEdit(): boolean {
    return (
      !!this.editing &&
      !this.editBusy &&
      this.editText.trim().length > 0 &&
      this.editAnswer.length > 0 &&
      this.editPin.length === 4
    );
  }

  async saveEdit(): Promise<void> {
    const target = this.editing;
    if (!target || !this.canSaveEdit) return;
    this.editBusy = true;
    this.editError = '';
    try {
      await this.parental.verify(this.editPin);
      this.editPin = '';
      await this.assignments.update(
        this.studentId,
        target.id,
        this.editText.trim(),
        Number(this.editAnswer),
      );
      this.editing = null;
      this.formOk = 'Tarea actualizada.';
      await this.loadTasks();
    } catch (error) {
      this.editPin = '';
      this.editError =
        error instanceof TutorError && error.code === 'already_answered'
          ? 'Esa tarea ya fue respondida: no se puede editar.'
          : error instanceof TutorError
            ? this.message(error)
            : pinMessage(error);
    } finally {
      this.editBusy = false;
      this.cdr.markForCheck();
    }
  }

  async remove(task: Assignment): Promise<void> {
    if (task.status !== 'pending') return;
    this.tasksError = '';
    try {
      await this.assignments.remove(this.studentId, task.id);
    } catch (error) {
      this.tasksError = this.message(error);
    }
    await this.loadTasks();
    this.cdr.markForCheck();
  }

  ratio(correct: number, total: number): number {
    return total ? correct / total : 0;
  }

  private async loadReport(): Promise<void> {
    try {
      this.report = await this.reports.get(this.studentId);
      this.reportError = '';
    } catch (error) {
      this.reportError = this.message(error);
    }
  }

  private async loadTasks(): Promise<void> {
    try {
      this.tasks = await this.assignments.all(this.studentId);
    } catch (error) {
      this.tasksError = this.message(error);
    }
  }

  private message(error: unknown): string {
    if (error instanceof TutorError && error.code === 'parental_required') {
      // El PIN venció (10 minutos): se pide de nuevo.
      this.session.end();
      void this.nav.navigateRoot('/pin');
      return 'Tu PIN venció. Escríbelo otra vez.';
    }
    if (error instanceof TutorError) {
      if ((error.code === 'rejected' || error.code === 'limit') && error.serverMessage) {
        return error.serverMessage;
      }
      return ERRORS[error.code] ?? ERRORS['unavailable'];
    }
    return ERRORS['unavailable'];
  }
}

export function pinMessage(error: unknown): string {
  if (error instanceof PinError) {
    if (error.code === 'wrong') {
      const n = error.remaining;
      if (n === null) return 'PIN incorrecto.';
      return n === 1 ? 'PIN incorrecto. Te queda 1 intento.' : `PIN incorrecto. Te quedan ${n} intentos.`;
    }
    if (error.code === 'locked') return 'Demasiados intentos. Espera 15 minutos.';
    if (error.code === 'network') return 'No pude conectar con el servidor.';
  }
  return 'No pude verificar el PIN. Inténtalo en un momento.';
}
