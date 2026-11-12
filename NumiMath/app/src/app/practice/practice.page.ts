import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import {
  AssignmentsPort,
  PendingAssignment,
  TutorError,
} from '../core/assignments/assignments.port';
import { ExplanationError, ExplanationPort } from '../core/explanation/explanation.port';
import { KID_ERRORS } from '../core/kid-messages';
import { PhraseKind, pickPhrase } from '../core/mascot/mascot-phrases';
import { MascotPort } from '../core/mascot/mascot.port';
import {
  AnswerResult,
  DiagnosticAnswer,
  Exercise,
  Level,
  PracticeError,
  PracticePort,
  Topic,
} from '../core/practice/practice.port';
import { FractionValue } from '../core/math/fraction-input.component';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { isOffline } from '../core/offline/offline-access';
import { OFFLINE_MESSAGES } from '../core/offline/offline-notice.component';
import { OfflineSyncService } from '../core/offline/offline-sync.service';
import { OfflineError, OfflinePracticeService } from '../core/offline/offline-practice.service';
import { dailyStreakHint, daysLabel } from '../core/progress/daily-streak';
import { ProgressPort } from '../core/progress/progress.port';
import { ScratchpadComponent } from '../core/scratchpad/scratchpad.component';
import { SheetsPort } from '../core/sheets/sheets.port';

/** Espera máxima a la sincronización antes de mostrar los temas (CU-A13). */
export const SYNC_WAIT_MS = 3000;

const ERRORS: Record<string, string> = {
  ...KID_ERRORS,
  expired: 'Ese ejercicio se cerró. Aquí va otro.',
  already_answered: 'Ese ejercicio ya estaba respondido. Aquí va otro.',
  not_found: 'Esa tarea ya no está. Aquí va la siguiente.',
};

/** Mensajes de la explicación de Numi: cortos, cálidos y sin culpar al niño. */
export const EXPLAIN_MESSAGES = {
  quota: 'Numi necesita descansar por hoy. ¡Sigue practicando mañana!',
  unavailable: 'Numi no pudo explicarlo ahora. Intenta de nuevo en un rato',
  interrupted: 'Numi no pudo terminar la explicación. Intenta de nuevo en un rato',
} as const;

export type ExplainState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

/** Símbolo decorativo para cada habilidad, elegido por palabras clave del nombre. */
const TOPIC_ICONS: [RegExp, string][] = [
  [/calculo mental/, '🧠'],
  [/patron/, '◆◇'],
  [/familia|inversa/, '🔄'],
  [/valor posicional|decenas y unidades|componer/, '🧮'],
  [/fraccion/, '½'],
  [/multiplic|tabla/, '×'],
  [/divi/, '÷'],
  [/perimetro|area/, '▢'],
  [/peso|gramo/, '⚖'],
  [/tiempo|hora/, '⏱'],
  [/longitud/, '📏'],
  [/ecuacion|igualdad/, '='],
  [/compar/, '<>'],
  [/resta|mitad/, '−'],
  [/suma|doble|calculo/, '+'],
  [/numero|contar|valor|decena/, '123'],
];

/** Sin tildes y en minúsculas, para buscar palabras clave. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function topicIcon(label: string): string {
  const text = plain(label);
  return TOPIC_ICONS.find(([pattern]) => pattern.test(text))?.[1] ?? '★';
}

export type Tone = 'teal' | 'coral' | 'lilac' | 'yellow';

export interface ModuleStyle {
  tone: Tone;
  icon: string;
}

/** Cada eje tiene su color e ícono fijos: el color ayuda a reconocer el eje de un vistazo. */
const MODULE_STYLES: [RegExp, ModuleStyle][] = [
  [/numero|operacion/, { tone: 'teal', icon: '🔢' }],
  [/patron|algebra/, { tone: 'lilac', icon: '🔷' }],
  [/medicion/, { tone: 'coral', icon: '📏' }],
  [/geometri/, { tone: 'yellow', icon: '📐' }],
];
const DEFAULT_MODULE_STYLE: ModuleStyle = { tone: 'lilac', icon: '★' };

export function moduleStyle(module: string | undefined): ModuleStyle {
  const text = plain(module ?? '');
  return MODULE_STYLES.find(([pattern]) => pattern.test(text))?.[1] ?? DEFAULT_MODULE_STYLE;
}

export interface TopicGroup {
  /** Nombre del grupo: el eje, o el curso en el repaso ("2° básico"). */
  title: string;
  style: ModuleStyle;
  topics: Topic[];
  mastered: number;
}

function group(topics: Topic[], key: (t: Topic) => string, style: (t: Topic) => ModuleStyle): TopicGroup[] {
  const groups: TopicGroup[] = [];
  for (const topic of topics) {
    const title = key(topic);
    let found = groups.find((g) => g.title === title);
    if (!found) {
      found = { title, style: style(topic), topics: [], mastered: 0 };
      groups.push(found);
    }
    found.topics.push(topic);
    if (topic.mastered) found.mastered += 1;
  }
  return groups;
}

/** Agrupa las habilidades por eje, en el orden en que llegan del servidor. */
export function groupByModule(topics: Topic[]): TopicGroup[] {
  return group(topics, (t) => t.module ?? '', (t) => moduleStyle(t.module));
}

/** Repaso: agrupado por curso (del más cercano al más lejano, como llega del servidor). */
export function groupByGrade(topics: Topic[]): TopicGroup[] {
  return group(
    topics,
    (t) => (t.grade ? `${t.grade}° básico` : 'Repaso'),
    () => ({ tone: 'yellow', icon: '🔁' }),
  );
}

/** Texto para el lector de pantalla de una baldosa: nombre, nivel y avance del bloque. */
export function tileLabel(topic: Topic): string {
  const parts = [topic.label];
  if (topic.review && topic.grade) parts.push(`repaso de ${topic.grade}° básico`);
  if (topic.exhausted) {
    parts.push('ya hiciste los ejercicios guardados');
  } else if (topic.mastered) {
    parts.push('dominada');
  } else {
    parts.push(`nivel ${topic.level ?? 1} de 3`);
    parts.push(`${topic.blockDone ?? 0} de ${topic.blockSize ?? 10} ejercicios`);
  }
  return parts.join(', ');
}

/** Ejercicios del diagnóstico inicial (CU-A2): 2 por nivel. */
export const DIAGNOSTIC_STEPS = 6;

/**
 * Textos del diagnóstico: cortos, sin presión de tiempo y sin hablar de errores. Si la prueba no
 * se puede terminar, el niño sigue practicando en el nivel 1 (excepción de la ficha CU-A2).
 */
export const DIAGNOSTIC_MESSAGES = {
  offer: '¿Hacemos una prueba corta?',
  offerDetail: 'Son 6 ejercicios para empezar en tu nivel. No importa si te equivocas.',
  done: '¡Listo!',
  fallback: 'Esta vez la prueba no se pudo guardar. Empiezas en el nivel 1.',
} as const;

export type DiagnosticState = 'offer' | 'running' | 'saving' | 'done' | null;

/** Aciertos seguidos que dan una medalla. */
export const MEDAL_EVERY = 5;

/** "Tema" de las tareas del tutor en la pantalla (no es un tema del servidor). */
export const TASKS_TOPIC: Topic = { id: 'tarea_tutor', label: 'Tareas de tu tutor' };

@Component({
  selector: 'app-practice',
  templateUrl: 'practice.page.html',
  styleUrls: ['practice.page.scss'],
  standalone: false,
})
export class PracticePage implements OnInit {
  private readonly practice = inject(PracticePort);
  private readonly progress = inject(ProgressPort);
  private readonly assignments = inject(AssignmentsPort);
  private readonly route = inject(ActivatedRoute);
  private readonly nav = inject(NavController);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly explainer = inject(ExplanationPort);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offline = inject(OfflinePracticeService);
  private readonly sync = inject(OfflineSyncService);
  private readonly sheets = inject(SheetsPort);
  protected readonly mascot = inject(MascotPort);

  studentId = '';
  topics: Topic[] = [];
  topic: Topic | null = null;
  exercise: Exercise | null = null;
  result: AnswerResult | null = null;
  answer = '';
  busy = false;
  loading = true;
  error = '';
  correctCount = 0;
  total = 0;

  // Premios de la sesión: solo en memoria, no se guardan en ningún lado.
  streak = 0;
  medals = 0;
  medalNow = false;
  confetti = 0;
  confettiCount = 40;
  message = pickPhrase('greet');

  // Racha de días: la guarda el servidor; aquí solo se muestra.
  dailyStreak = 0;
  practicedToday = false;
  dailyLoaded = false;
  dayStreakNow = false;
  protected readonly daysLabel = daysLabel;
  protected readonly starSlots = Array.from({ length: MEDAL_EVERY }, (_, i) => i);

  // Dificultad: la decide el servidor; aquí solo se muestra y se celebra cuando sube.
  levelUpNow = false;
  private lastLevel: number | null = null;
  // Dominio: se celebra una vez, cuando el servidor marca la habilidad como dominada.
  masteredNow = false;
  private lastMastered: boolean | null = null;

  // Habilidades agrupadas por eje (su curso) y las de repaso (cursos anteriores, plegadas).
  ownGroups: TopicGroup[] = [];
  reviewTopics: Topic[] = [];
  reviewGroups: TopicGroup[] = [];
  showReview = false;

  // Respuesta de fracción (numerador y denominador, escritos a mano).
  fraction: FractionValue = { num: '', den: '' };

  // Papel para calcular: abierto o cerrado. Lo dibujado se guarda SOLO si el niño tiene un docente
  // vinculado (CU-A22): sola al responder y a mano con "Guardar el papel". Sin vínculo o sin red no
  // se guarda y no se muestra ningún error. Las hojas no entran a la cola sin conexión.
  paperOpen = false;
  sheetNotice = '';
  private sheetNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  @ViewChild(ScratchpadComponent) private paper?: ScratchpadComponent;

  // Tareas del tutor: el niño recibe solo id y texto; corrige el servidor.
  tasks: PendingAssignment[] = [];
  tasksDone = false;
  /** Ticket de la tarea abierta (para que el servidor mida el tiempo). */
  private taskTicket: string | null = null;

  // Explicación de Numi tras un error. El texto vive solo en memoria de esta pantalla.
  explainState: ExplainState = 'idle';
  explainText = '';
  explainNotice = '';
  private explainRetry = false;
  private explainCtrl: AbortController | null = null;

  // Diagnóstico inicial (CU-A2). Las respuestas viven SOLO en memoria hasta el final: si el niño
  // sale a la mitad no se envía nada y la habilidad queda en nivel 1.
  diag: DiagnosticState = null;
  diagStep = 0;
  diagLevel: Level = 1;
  diagNotice = '';
  private diagAnswers: DiagnosticAnswer[] = [];
  protected readonly diagSteps = DIAGNOSTIC_STEPS;
  protected readonly diagMessages = DIAGNOSTIC_MESSAGES;

  // Sin conexión (CU-A12): se practica con el lote guardado y cada intento queda en la cola
  // local. Sin tareas, diagnóstico, repaso, racha ni explicación de Numi (necesitan internet).
  offlineMode = false;
  /** Aviso del modo sin conexión: sin lote o lote agotado. */
  offlineNotice = '';
  protected readonly offlineMessages = OFFLINE_MESSAGES;

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelExplanation());
  }

  /** Se ofrece tras una respuesta incorrecta, nunca en las tareas del tutor (su texto no va a la IA). */
  get canExplain(): boolean {
    return (
      !!this.exercise &&
      !!this.result &&
      !this.result.correct &&
      !this.taskMode &&
      // Sin conexión no hay IA (la app nunca la llama directo; todo pasa por FastAPI).
      !this.exercise.offline &&
      this.exercise.topic !== TASKS_TOPIC.id
    );
  }

  /** Texto para la burbuja: un paso por línea, sin el salto final (no deja una línea vacía). */
  get explainShown(): string {
    return this.explainText.replace(/\s+$/, '');
  }

  get explaining(): boolean {
    return this.explainState === 'loading' || this.explainState === 'streaming';
  }

  get showExplainButton(): boolean {
    if (!this.canExplain) return false;
    return this.explaining || this.explainState === 'idle' || this.explainRetry;
  }

  get taskMode(): boolean {
    return this.topic?.id === TASKS_TOPIC.id;
  }

  get fractionMode(): boolean {
    return this.exercise?.answerKind === 'fraction';
  }

  protected levelStars(level: number): string {
    return '★'.repeat(level) + '☆'.repeat(3 - level);
  }

  get dailyHint(): string {
    return dailyStreakHint(this.dailyStreak, this.practicedToday);
  }

  /** Estrellas encendidas en la fila: se llena hasta la medalla y vuelve a empezar. */
  get filledStars(): number {
    if (this.streak > 0 && this.streak % MEDAL_EVERY === 0) return MEDAL_EVERY;
    return this.streak % MEDAL_EVERY;
  }

  protected readonly topicIcon = topicIcon;


  async ngOnInit(): Promise<void> {
    this.studentId = this.route.snapshot.paramMap.get('id') ?? '';
    // Si el navegador cree que hay red se intenta en línea, aunque antes haya fallado una
    // petición: solo una falla por red lleva al lote (no basta `navigator.onLine`).
    if (this.connectivity.browserOnline()) {
      await this.loadOnline();
    } else {
      await this.loadOffline();
    }
    // Desde "Tareas de tu tutor": arranca en modo tareas. Se escucha la dirección (no la foto
    // inicial) porque, si la práctica ya estaba abierta más atrás, Ionic vuelve a ESA pantalla
    // sin volver a llamar a ngOnInit: solo cambian los parámetros. Sin conexión no hay tareas.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      if (query.get('tareas') === '1' && !this.offlineMode) void this.startTasks(query.get('desde'));
    });
  }

  private async loadOnline(): Promise<void> {
    // Las tareas del tutor no dependen de la cola sin conexión: se piden de inmediato.
    const tasks = this.loadTasks();
    // CU-A13: antes de leer nivel, bloque y racha se envían los intentos hechos sin conexión, así
    // lo que se muestra ya los incluye. Se espera como máximo 3 s (decisión del dueño): con una
    // cola larga o red lenta se sigue en línea con un aviso y el envío continúa en segundo plano.
    const synced = await this.sync.syncWithin(this.studentId, SYNC_WAIT_MS);
    const daily = this.loadDaily();
    let online = true;
    try {
      this.setTopics(await this.practice.topics(this.studentId));
      this.connectivity.reportSuccess();
      this.offlineNotice = synced === 'pending' ? OFFLINE_MESSAGES.syncPending : '';
      // Con conexión se deja listo (o se renueva) el lote para practicar sin internet.
      // Mejor esfuerzo y sin esperar: la práctica en línea no depende de esto.
      void this.offline.refresh(this.studentId);
    } catch (error) {
      online = !this.isNetwork(error);
      if (online) this.fail(error);
      // El servidor dice que este perfil ya no se puede usar (borrado, en pausa o sin permiso):
      // se borra lo guardado para que no siga practicando al quedarse sin red.
      if (error instanceof PracticeError && error.code === 'forbidden') {
        await this.offline.forget(this.studentId);
      }
    } finally {
      await Promise.all([daily, tasks]);
      if (online) {
        this.loading = false;
        this.cdr.markForCheck();
      }
    }
    if (!online) await this.goOffline();
  }

  /** Paso 1 de la ficha: no hay conexión. Se muestran las habilidades del lote guardado. */
  private async loadOffline(): Promise<void> {
    this.offlineMode = true;
    this.dailyLoaded = false;
    this.tasks = [];
    this.error = '';
    try {
      this.setTopics(await this.offline.topics(this.studentId));
      this.offlineNotice = '';
    } catch {
      // Sin lote (o vencido): hace falta conectarse una vez para descargarlo.
      this.setTopics([]);
      this.offlineNotice = OFFLINE_MESSAGES.noBatch;
    }
    // Sin tristeza: no es culpa del niño.
    this.mascot.set('idle');
    this.loading = false;
    this.cdr.markForCheck();
  }

  /** Una petición falló por red: se pasa a practicar con el lote, desde la lista de temas. */
  private async goOffline(): Promise<void> {
    this.connectivity.reportNetworkFailure();
    this.cancelExplanation();
    this.resetDiagnostic();
    this.topic = null;
    this.exercise = null;
    this.result = null;
    this.message = pickPhrase('greet');
    await this.loadOffline();
  }

  private isNetwork(error: unknown): boolean {
    return error instanceof PracticeError && error.code === 'network';
  }

  /** Recarga las tareas pendientes y empieza por la elegida (`desde`), si viene. */
  private async startTasks(from: string | null): Promise<void> {
    await this.loadTasks();
    const i = this.tasks.findIndex((t) => t.id === from);
    if (i > 0) this.tasks = [this.tasks[i], ...this.tasks.slice(0, i), ...this.tasks.slice(i + 1)];
    await this.chooseTasks();
  }

  /** Pantalla con las tareas del tutor (pendientes y hechas). */
  async openTasks(): Promise<boolean> {
    // Las tareas las corrige el servidor. Sin red se avisa sin intentar; si el navegador cree que
    // hay red se intenta, y si el guard no deja pasar por falta de conexión, también se avisa.
    if (this.offlineMode && !this.connectivity.browserOnline()) {
      this.offlineNotice = OFFLINE_MESSAGES.needsInternet;
      return false;
    }
    const opened = await this.nav.navigateForward(['/tareas', this.studentId]);
    if (!opened && isOffline(this.connectivity)) {
      this.offlineNotice = OFFLINE_MESSAGES.needsInternet;
      this.cdr.markForCheck();
    }
    return opened;
  }

  async choose(topic: Topic): Promise<void> {
    this.topic = topic;
    this.correctCount = 0;
    this.total = 0;
    this.streak = 0;
    this.medalNow = false;
    this.lastLevel = null;
    this.lastMastered = null;
    this.tasksDone = false;
    this.offlineNotice = '';
    this.resetDiagnostic();
    // Primera vez en esta habilidad: se ofrece la prueba corta (opcional). Nunca en las tareas
    // ni sin conexión (el diagnóstico se guarda en el servidor).
    if (topic.diagnosticAvailable && topic.id !== TASKS_TOPIC.id && !this.offlineMode) {
      this.exercise = null;
      this.result = null;
      this.diag = 'offer';
      this.message = DIAGNOSTIC_MESSAGES.offer;
      this.mascot.set('happy');
      this.focusDiagnosticTitle();
      return;
    }
    await this.next();
  }

  /** "No, empezar a practicar": parte en el nivel 1, como siempre. */
  async declineDiagnostic(): Promise<void> {
    this.resetDiagnostic();
    await this.next();
  }

  /** "Sí, probar": 6 ejercicios seguidos, sin decir si cada uno estaba bien. */
  async startDiagnostic(): Promise<void> {
    if (!this.topic || this.diag !== 'offer') return;
    this.diag = 'running';
    this.diagStep = 0;
    this.diagAnswers = [];
    await this.nextDiagnostic();
  }

  /** "Empezar a practicar" tras la prueba: sigue la práctica normal (CU-A1) en el nivel guardado. */
  async startAfterDiagnostic(): Promise<void> {
    this.resetDiagnostic();
    await this.next();
  }

  private async nextDiagnostic(): Promise<void> {
    if (!this.topic) return;
    const topic = this.topic;
    this.busy = true;
    this.error = '';
    this.answer = '';
    this.fraction = { num: '', den: '' };
    this.message = '';
    this.mascot.set('idle');
    try {
      const exercise = await this.practice.diagnosticExercise(this.studentId, topic.id, this.diagStep);
      // Si el niño salió mientras llegaba, se descarta.
      if (this.diag !== 'running' || this.topic !== topic) return;
      this.exercise = exercise;
    } catch (error) {
      if (this.diag !== 'running' || this.topic !== topic) return;
      this.diagnosticFailed(error);
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  /** Guarda la respuesta en memoria y pasa al siguiente; tras el sexto, envía todo. */
  private async answerDiagnostic(): Promise<void> {
    if (!this.exercise) return;
    this.diagAnswers.push(
      this.fractionMode
        ? {
            token: this.exercise.token,
            answer: Number(this.fraction.num),
            answerDen: Number(this.fraction.den),
          }
        : { token: this.exercise.token, answer: Number(this.answer) },
    );
    this.paperOpen = false;
    this.diagStep += 1;
    if (this.diagStep < DIAGNOSTIC_STEPS) {
      await this.nextDiagnostic();
      return;
    }
    await this.finishDiagnostic();
  }

  private async finishDiagnostic(): Promise<void> {
    if (!this.topic) return;
    const topic = this.topic;
    this.diag = 'saving';
    this.exercise = null;
    this.busy = true;
    this.mascot.set('thinking');
    this.cdr.markForCheck();
    try {
      const level = await this.practice.submitDiagnostic(this.studentId, topic.id, this.diagAnswers);
      if (this.diag !== 'saving' || this.topic !== topic) return;
      this.diagAnswers = [];
      this.diagLevel = level;
      this.diag = 'done';
      this.message = DIAGNOSTIC_MESSAGES.done;
      this.mascot.set('happy');
      this.focusDiagnosticTitle();
    } catch (error) {
      if (this.diag !== 'saving' || this.topic !== topic) return;
      this.diagnosticFailed(error);
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * La prueba no se pudo terminar (venció, sin red…): no se guardó nada y la habilidad queda en
   * nivel 1. Si ya tenía práctica (409), se sigue directo con la práctica, en su nivel.
   */
  private diagnosticFailed(error: unknown): void {
    this.diagAnswers = [];
    this.exercise = null;
    if (error instanceof PracticeError && error.code === 'already_answered') {
      this.resetDiagnostic();
      this.busy = false;
      void this.next();
      return;
    }
    if (error instanceof PracticeError && error.code === 'session') {
      this.resetDiagnostic();
      this.fail(error);
      return;
    }
    this.diag = 'done';
    this.diagLevel = 1;
    this.diagNotice = DIAGNOSTIC_MESSAGES.fallback;
    this.message = '';
    // Sin tristeza: no es culpa del niño y la práctica sigue.
    this.mascot.set('idle');
    this.focusDiagnosticTitle();
  }

  /** Olvida la prueba en curso (al salir, cambiar de tema o terminar). Nada se envía. */
  private resetDiagnostic(): void {
    this.diag = null;
    this.diagStep = 0;
    this.diagAnswers = [];
    this.diagLevel = 1;
    this.diagNotice = '';
  }

  /** Lleva el foco del lector de pantalla al título de la oferta o del resultado. */
  private focusDiagnosticTitle(): void {
    this.cdr.detectChanges();
    this.host.nativeElement.querySelector<HTMLElement>('[data-testid="diag-title"]')?.focus();
  }

  /** Empieza las tareas del tutor (una por una, en orden). */
  chooseTasks(): Promise<void> {
    return this.choose(TASKS_TOPIC);
  }

  async next(): Promise<void> {
    if (!this.topic || this.busy || this.diag) return;
    this.cancelExplanation();
    if (this.taskMode) {
      this.nextTask();
      return;
    }
    this.busy = true;
    this.error = '';
    this.result = null;
    this.answer = '';
    this.fraction = { num: '', den: '' };
    this.medalNow = false;
    this.levelUpNow = false;
    this.masteredNow = false;
    this.dayStreakNow = false;
    this.say('thinking');
    this.mascot.set('thinking');
    try {
      this.exercise = this.offlineMode
        ? await this.offline.next(this.studentId, this.topic.id)
        : await this.practice.newExercise(this.studentId, this.topic.id);
      this.message = '';
      this.mascot.set('idle');
      this.levelUpNow = this.lastLevel !== null && this.exercise.level > this.lastLevel;
      this.lastLevel = this.exercise.level;
      const mastered = this.exercise.mastered === true;
      this.masteredNow = this.lastMastered === false && mastered;
      this.lastMastered = mastered;
      if (this.levelUpNow || this.masteredNow) {
        this.confettiCount = 90;
        this.confetti += 1;
        this.say(this.masteredNow ? 'mastered' : 'levelUp');
        this.mascot.set('happy');
      }
    } catch (error) {
      this.exercise = null;
      if (error instanceof OfflineError) {
        // Excepción de la ficha: se acabó el lote de este tema (o no hay lote).
        this.offlineNotice =
          error.code === 'no_batch' ? OFFLINE_MESSAGES.noBatch : OFFLINE_MESSAGES.exhausted;
        this.message = '';
        this.mascot.set('idle');
      } else if (!this.offlineMode && this.isNetwork(error)) {
        this.busy = false;
        await this.goOffline();
      } else {
        this.fail(error);
      }
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  onAnswerInput(value: string | null | undefined): void {
    // Solo dígitos: la respuesta es un número, nunca texto libre.
    this.answer = (value ?? '').replace(/\D/g, '').slice(0, 7);
  }

  get canSubmit(): boolean {
    if (!this.exercise || this.result || this.busy) return false;
    if (this.fractionMode) return this.fraction.num.length > 0 && Number(this.fraction.den) > 0;
    return this.answer.length > 0;
  }

  async submit(): Promise<void> {
    if (!this.exercise || !this.canSubmit) return;
    if (this.diag === 'running') {
      await this.answerDiagnostic();
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      if (this.taskMode) {
        // En modo tareas, `token` es el id de la tarea.
        this.result = await this.assignments.answer(
          this.studentId,
          this.exercise.token,
          Number(this.answer),
          this.taskTicket,
        );
        this.tasks = this.tasks.filter((t) => t.id !== this.exercise?.token);
      } else if (this.exercise.offline) {
        // Sin conexión: corrige con la solución guardada y la promesa se cumple recién cuando
        // el intento quedó guardado en el dispositivo (RNF-06). Antes no se muestra nada.
        this.result = this.fractionMode
          ? await this.offline.answer(
              this.studentId,
              this.exercise.token,
              Number(this.fraction.num),
              Number(this.fraction.den),
            )
          : await this.offline.answer(this.studentId, this.exercise.token, Number(this.answer));
      } else {
        this.result = this.fractionMode
          ? await this.practice.answer(
              this.studentId,
              this.exercise.token,
              Number(this.fraction.num),
              Number(this.fraction.den),
            )
          : await this.practice.answer(this.studentId, this.exercise.token, Number(this.answer));
      }
      void this.saveSheet(); // automático: solo guarda si hay trazos y un docente vinculado
      this.total += 1;
      if (this.result.correct) {
        this.correctCount += 1;
        this.celebrate();
      } else {
        this.streak = 0;
        this.say('wrong');
      }
      // Tras un error Numi piensa contigo (no se pone triste: sin culpa). 'sad' queda solo para
      // fallas técnicas.
      this.mascot.set(this.result.correct ? 'happy' : 'thinking');
      // La racha de días la calcula el servidor: sin conexión no se relee.
      if (!this.practicedToday && !this.offlineMode) void this.celebrateDay();
    } catch (error) {
      if (error instanceof OfflineError) {
        if (error.code === 'storage') {
          // No quedó guardado: no se confirma nada y el niño puede volver a responder.
          this.error = OFFLINE_MESSAGES.storage;
          this.mascot.set('idle');
          return;
        }
        // El ejercicio ya no está disponible (usado o vencido): pasa al siguiente del lote.
        this.busy = false;
        await this.next();
        return;
      }
      if (!this.offlineMode && !this.taskMode && this.isNetwork(error)) {
        this.busy = false;
        await this.goOffline();
        return;
      }
      this.fail(error);
      if (
        error instanceof TutorError &&
        (error.code === 'already_answered' || error.code === 'not_found')
      ) {
        // La tarea ya no está pendiente (respondida en otro equipo o borrada): pasa a la siguiente.
        this.tasks = this.tasks.filter((t) => t.id !== this.exercise?.token);
        this.busy = false;
        this.next();
        return;
      }
      if (
        error instanceof PracticeError &&
        (error.code === 'expired' || error.code === 'already_answered')
      ) {
        this.busy = false;
        await this.next();
        return;
      }
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  togglePaper(): void {
    this.paperOpen = !this.paperOpen;
  }

  /**
   * Guardado manual de la hoja (el automático ya ocurrió al responder). Dice "Guardado" si resultó; si
   * no, un aviso suave (sin vínculo, sin red o un fallo del servidor): nunca un error alarmante.
   */
  async savePaper(): Promise<void> {
    const drawn = !!this.paper?.snapshot();
    const saved = await this.saveSheet();
    this.sheetNotice = saved
      ? 'Guardado'
      : drawn
        ? 'No se pudo guardar ahora.'
        : 'Dibuja algo en el papel para guardarlo.';
    if (this.sheetNoticeTimer) clearTimeout(this.sheetNoticeTimer);
    this.sheetNoticeTimer = setTimeout(() => {
      this.sheetNotice = '';
      this.cdr.markForCheck();
    }, 2500);
    this.cdr.markForCheck();
  }

  /**
   * Guarda la hoja del ejercicio ya respondido (upsert: una por ejercicio). Los trazos se copian ANTES
   * de cualquier espera, así que pasar al siguiente ejercicio no los pierde. Nunca lanza.
   */
  private async saveSheet(): Promise<boolean> {
    const exercise = this.exercise;
    const strokes = this.paper?.snapshot();
    if (!exercise || !this.result || !strokes) return false;
    if (this.offlineMode || exercise.offline) return false;
    // Todo se copia ANTES de esperar: si el niño pasa al siguiente ejercicio, no cambia lo que se guarda.
    const student = this.studentId;
    const token = exercise.token;
    const task = this.taskMode;
    const fraction = this.fractionMode ? { num: Number(this.fraction.num), den: Number(this.fraction.den) } : null;
    const answer = Number(this.answer);
    // Sin docente vinculado el dibujo no sale del dispositivo.
    if (!(await this.sheets.enabled(student))) return false;
    if (task) return this.sheets.saveTask(student, token, answer, strokes);
    return fraction
      ? this.sheets.savePractice(student, token, fraction.num, fraction.den, strokes)
      : this.sheets.savePractice(student, token, answer, null, strokes);
  }

  /** "Explícame cómo se hace": pide la explicación por streaming. Una petición a la vez. */
  async explain(): Promise<void> {
    if (!this.canExplain || this.explaining || !this.exercise) return;
    this.cancelExplanation();
    const ctrl = new AbortController();
    this.explainCtrl = ctrl;
    const current = () => this.explainCtrl === ctrl;
    this.explainState = 'loading';
    this.explainRetry = false;
    this.message = '';
    this.mascot.set('thinking');
    this.showExplainer();
    try {
      await this.explainer.explain(
        this.studentId,
        // Solo el tema (id de la habilidad) y el enunciado generado por el servidor.
        { topic: this.exercise.topic, exercise: this.exercise.text },
        (text) => {
          if (!current()) return;
          const glue = this.explainText && !/\s$/.test(this.explainText) ? ' ' : '';
          this.explainText += glue + text;
          if (this.explainState !== 'streaming') {
            this.explainState = 'streaming';
            this.mascot.set('talking');
          }
          this.cdr.markForCheck();
        },
        ctrl.signal,
      );
      if (!current()) return;
      this.finishExplanation('done');
    } catch (error) {
      if (!current()) return;
      const code = error instanceof ExplanationError ? error.code : 'unavailable';
      if (code === 'aborted') return;
      if (code === 'rejected') {
        this.explainNotice =
          (error as ExplanationError).childMessage ?? EXPLAIN_MESSAGES.unavailable;
      } else if (code === 'interrupted') {
        this.explainNotice =
          (error as ExplanationError).childMessage ?? EXPLAIN_MESSAGES.interrupted;
        this.explainRetry = true;
      } else {
        this.explainNotice = EXPLAIN_MESSAGES[code];
        this.explainRetry = code === 'unavailable';
      }
      this.finishExplanation('error');
    } finally {
      if (current()) this.explainCtrl = null;
    }
  }

  /** Numi baja junto a su explicación: se dibuja la fila y la pantalla se desplaza hasta ella. */
  private showExplainer(): void {
    this.cdr.detectChanges();
    const row = this.host.nativeElement.querySelector<HTMLElement>('[data-testid="explain-row"]');
    const calm =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }

  /** Ionic guarda la pantalla al navegar: se corta la explicación al salir. */
  ionViewWillLeave(): void {
    this.cancelExplanation();
    // Salir a la mitad del diagnóstico es abandonarlo: se olvida y no se envía nada.
    if (this.diag) {
      this.resetDiagnostic();
      this.topic = null;
      this.exercise = null;
    }
  }

  /** Corta la petición en curso y olvida el texto. */
  private cancelExplanation(): void {
    this.explainCtrl?.abort();
    this.explainCtrl = null;
    this.explainState = 'idle';
    this.explainText = '';
    this.explainNotice = '';
    this.explainRetry = false;
  }

  private finishExplanation(state: 'done' | 'error'): void {
    // Si el botón tenía el foco y va a desaparecer, el foco pasa a la burbuja (teclado).
    const active = document.activeElement;
    const button = this.host.nativeElement.querySelector('[data-testid="explain-btn"]');
    const hadFocus = !!button && !!active && button.contains(active);
    this.explainState = state;
    this.mascot.set('idle');
    this.cdr.detectChanges();
    if (hadFocus && !this.showExplainButton) {
      this.host.nativeElement.querySelector<HTMLElement>('[data-testid="explain-bubble"]')?.focus();
    }
  }

  changeTopic(): void {
    this.cancelExplanation();
    this.resetDiagnostic();
    this.topic = null;
    this.exercise = null;
    this.result = null;
    this.offlineNotice = '';
    this.say('greet');
    this.mascot.set('idle');
    void (this.offlineMode ? this.reloadAfterOffline() : this.reloadTopics());
  }

  /**
   * Al volver a la lista sin conexión: si el navegador cree que volvió la red, se intenta en
   * línea; si funciona, se sale del modo sin conexión. Si no, se releen las habilidades del lote.
   */
  private async reloadAfterOffline(): Promise<void> {
    if (this.connectivity.browserOnline()) {
      try {
        const topics = await this.practice.topics(this.studentId);
        this.offlineMode = false;
        this.offlineNotice = '';
        this.connectivity.reportSuccess();
        this.setTopics(topics);
        void this.offline.refresh(this.studentId);
        await Promise.all([this.loadDaily(), this.loadTasks()]);
        this.cdr.markForCheck();
        return;
      } catch {
        // Sigue sin conexión.
      }
    }
    await this.loadOffline();
  }

  toggleReview(): void {
    this.showReview = !this.showReview;
  }

  /** Texto de la respuesta correcta ("12" o "3/5"). */
  protected correctText(result: AnswerResult): string {
    if (result.correctAnswer === undefined) return '';
    return result.correctAnswerDen === undefined
      ? String(result.correctAnswer)
      : `${result.correctAnswer}/${result.correctAnswerDen}`;
  }

  private setTopics(topics: Topic[]): void {
    this.topics = topics;
    this.ownGroups = groupByModule(topics.filter((t) => !t.review));
    this.reviewTopics = topics.filter((t) => t.review);
    this.reviewGroups = groupByGrade(this.reviewTopics);
  }

  /** Al volver a la lista, se releen estrellas y dominio. Mejor esfuerzo. */
  private async reloadTopics(): Promise<void> {
    try {
      this.setTopics(await this.practice.topics(this.studentId));
      this.cdr.markForCheck();
    } catch {
      // Se queda la lista anterior.
    }
  }

  /** Siguiente tarea pendiente, con la misma pantalla que un ejercicio. Sin nivel. */
  private nextTask(): void {
    this.error = '';
    this.result = null;
    this.answer = '';
    this.medalNow = false;
    this.levelUpNow = false;
    this.masteredNow = false;
    this.dayStreakNow = false;
    const task = this.tasks[0];
    if (!task) {
      this.exercise = null;
      this.tasksDone = true;
      this.say('tasksDone');
      this.mascot.set('happy');
    } else {
      this.exercise = { token: task.id, topic: TASKS_TOPIC.id, text: task.text, level: 1, expiresIn: 0 };
      this.message = '';
      this.mascot.set('idle');
      void this.startTask(task.id);
    }
    this.cdr.markForCheck();
  }

  /** Pide el ticket de la tarea. Mejor esfuerzo: si falla, se responde igual (sin tiempo). */
  private async startTask(id: string): Promise<void> {
    this.taskTicket = null;
    try {
      const ticket = await this.assignments.start(this.studentId, id);
      if (this.exercise?.token === id) this.taskTicket = ticket;
    } catch {
      this.taskTicket = null;
    }
  }

  /** Tareas pendientes. Mejor esfuerzo: si fallan, la práctica normal sigue. */
  private async loadTasks(): Promise<void> {
    try {
      this.tasks = (await this.assignments.forKid(this.studentId)).pending;
    } catch {
      this.tasks = [];
    }
  }

  private celebrate(): void {
    this.streak += 1;
    this.medalNow = this.streak % MEDAL_EVERY === 0;
    if (this.medalNow) this.medals += 1;
    this.confettiCount = this.medalNow ? 90 : 40;
    this.confetti += 1;
    this.say(this.medalNow ? 'medal' : 'correct');
  }

  /** Lee la racha de días. Mejor esfuerzo: si falla, la práctica sigue sin mostrarla. */
  private async loadDaily(): Promise<boolean> {
    try {
      const p = await this.progress.get(this.studentId);
      this.dailyStreak = p.dailyStreak;
      this.practicedToday = p.practicedToday;
      this.dailyLoaded = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Primera respuesta del día: el servidor ya sumó el día; se relee y se celebra una vez. */
  private async celebrateDay(): Promise<void> {
    if (!(await this.loadDaily())) return;
    this.dayStreakNow = this.practicedToday && this.dailyStreak > 0;
    this.cdr.markForCheck();
  }

  private say(kind: PhraseKind): void {
    this.message = pickPhrase(kind);
  }

  private fail(error: unknown): void {
    const code =
      error instanceof PracticeError || error instanceof TutorError ? error.code : 'unavailable';
    this.error = ERRORS[code] ?? ERRORS['unavailable'];
    this.message = '';
    this.mascot.set('sad');
  }
}
