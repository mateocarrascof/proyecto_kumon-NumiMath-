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

import { splitLeadingEmoji } from '../core/games/games.messages';
import { GameInfo, GamesPort } from '../core/games/games.port';

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
import { MEDAL_EVERY } from '../core/practice/medals';
import { StreakReminderService } from '../core/reminders/streak-reminder.service';
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
  // Rechazar es definitivo (decisión del dueño): antes se confirma, con calma.
  // Sin doble negación y sin la palabra "prueba" en el error (revisión child-safety).
  declineTitle: '¿Practicar sin la prueba?',
  declineDetail: 'Si dices que no, no podrás hacer esta prueba después. Igual puedes practicar todo lo que quieras.',
  declineWait: 'Léelo con calma. En un momento puedes elegir.',
  declineConfirm: 'No quiero la prueba',
  declineBack: 'Volver',
  declineReady: 'Ya puedes elegir.',
  declineError: 'No pudimos guardarlo. Inténtalo de nuevo.',
  declineRetry: 'Intentar otra vez',
  declinePracticeAnyway: 'Empezar a practicar igual',
} as const;

/**
 * Espera antes de poder confirmar el rechazo del test: para leerlo con calma. Sin cuenta atrás
 * visible (no presiona); el lector de pantalla anuncia cuando el botón ya se puede usar.
 */
export const DECLINE_WAIT_MS = 3000;

export type DiagnosticState = 'offer' | 'running' | 'saving' | 'done' | null;

// Aciertos seguidos que dan una medalla: compartido con los juegos (CU-A21).
export { MEDAL_EVERY };

/** "Tema" de las tareas del tutor en la pantalla (no es un tema del servidor). */
export const TASKS_TOPIC: Topic = { id: 'tarea_tutor', label: 'Tareas de tu tutor' };

/** Cuánto se reutiliza la respuesta de `sheets.enabled` para un perfil. */
const SHEETS_ENABLED_TTL_MS = 5 * 60 * 1000;

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
  private readonly games = inject(GamesPort);
  /** Juegos por habilidad (null: aún no se piden o no se pudieron leer). */
  private gamesBySkill: Map<string, GameInfo[]> | null = null;
  private allGames: GameInfo[] | null = null;
  private gamesLoading = false;
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly explainer = inject(ExplanationPort);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offline = inject(OfflinePracticeService);
  private readonly sync = inject(OfflineSyncService);
  private readonly sheets = inject(SheetsPort);
  private readonly reminders = inject(StreakReminderService);
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
  // vinculado (CU-A22), solo, sin botón: al responder, al pasar a "Siguiente" y al cerrar el papel, si hay
  // trazos nuevos. Sin vínculo o sin red no se guarda y no se muestra ningún error. Las hojas no entran a
  // la cola sin conexión.
  paperOpen = false;
  /** Hay un docente vinculado que puede ver el papel (solo para mostrar el aviso fijo). */
  teacherSeesPaper = false;
  /** Ejercicio ya respondido cuya hoja se guarda (se copia al responder: el niño puede cambiar de pantalla). */
  private sheetTarget: {
    student: string;
    token: string;
    task: boolean;
    answer: number;
    fraction: { num: number; den: number } | null;
  } | null = null;
  /** Trazos (JSON) del último guardado pedido para `sheetTarget`: evita repetir el mismo guardado. */
  private sheetSaved = '';
  /** Guardados en fila: así dos guardados del mismo ejercicio salen en orden (el upsert deja el último). */
  private sheetQueue: Promise<unknown> = Promise.resolve();
  /** ¿Hay docente vinculado? Se pregunta una vez por perfil y se reutiliza unos minutos. */
  private sheetsEnabledCache: { student: string; at: number; value: Promise<boolean> } | null = null;
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
  /** Rechazo del test: confirmación (botón desactivado unos segundos) o error al guardarlo. */
  declineStep: 'confirm' | 'error' | null = null;
  declineReady = false;
  declineBusy = false;
  /** Para pruebas. */
  declineWaitMs = DECLINE_WAIT_MS;
  private declineTimer: ReturnType<typeof setTimeout> | null = null;
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
  /**
   * CU-A21: "Jugar" solo para 1° y 2° básico, con conexión. El curso se deduce de las habilidades
   * propias del perfil (sin otra llamada); si no se puede deducir, no se muestra.
   */
  get canPlay(): boolean {
    if (this.offlineMode) return false;
    const grades = new Set(this.topics.filter((t) => !t.review).map((t) => t.grade));
    if (grades.size !== 1) return false;
    const [grade] = grades;
    return grade === 1 || grade === 2;
  }

  /**
   * "Más juegos": solo los juegos de temas que este perfil NO practica (fase B: geometría,
   * medición, reloj, gráficos; en 1°, los temas 6 a 10). Los de temas que se practican se abren
   * con "Aprender jugando" dentro de cada tema. Vacío: la tarjeta no aparece.
   */
  get extraGames(): GameInfo[] {
    if (!this.canPlay || !this.allGames) return [];
    const practiced = new Set(this.topics.map((t) => t.id));
    return this.allGames.filter((g) => !g.skill || !practiced.has(g.skill));
  }

  /** La selección de eje, con solo esos juegos (`?juegos=`). */
  openGames(): Promise<boolean> {
    const juegos = this.extraGames.map((g) => g.id).join(',');
    return this.nav.navigateForward(['/juegos', this.studentId], { queryParams: { juegos } });
  }

  /** Emoji al principio del enunciado (contar): van aparte, en filas, encima de la pregunta. */
  get exerciseEmoji(): { glyphs: string; rest: string; spoken: string } | null {
    return this.exercise ? splitLeadingEmoji(this.exercise.text) : null;
  }

  /**
   * "Aprender jugando": juegos del tema actual. Solo 1° y 2°, con conexión y si el tema tiene
   * juego (la lista se pide una vez, al entrar al primer tema; si falla, no se muestra).
   */
  get topicGames(): GameInfo[] {
    // Nunca durante la prueba corta ni su oferta: tocarlo la abandonaría sin aviso.
    if (!this.topic || this.diag || !this.canPlay || !this.gamesBySkill) return [];
    return this.gamesBySkill.get(this.topic.id) ?? [];
  }

  /** Un juego: directo a su introducción. Varios: la lista con solo los de este tema. */
  learnPlaying(): Promise<boolean> {
    const games = this.topicGames;
    const queryParams = games.length === 1 ? { juego: games[0].id } : { tema: this.topic?.id };
    return this.nav.navigateForward(['/juegos', this.studentId], { queryParams });
  }

  private async loadTopicGames(): Promise<void> {
    if (this.gamesBySkill || this.gamesLoading || !this.canPlay) return;
    this.gamesLoading = true;
    try {
      const bySkill = new Map<string, GameInfo[]>();
      const all = (await this.games.list(this.studentId)).flatMap((g) => g.games);
      for (const game of all) {
        if (game.skill) bySkill.set(game.skill, [...(bySkill.get(game.skill) ?? []), game]);
      }
      this.gamesBySkill = bySkill;
      this.allGames = all;
    } catch {
      // Mejor esfuerzo: sin la lista no aparecen "Aprender jugando" ni "Más juegos".
    } finally {
      this.gamesLoading = false;
      this.cdr.markForCheck();
    }
  }

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
    void this.loadTopicGames();
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

  /** "No, empezar a practicar": rechazar es definitivo, así que primero se confirma. */
  askDecline(): void {
    if (this.diag !== 'offer') return;
    this.clearDeclineTimer();
    this.declineStep = 'confirm';
    this.declineReady = false;
    this.message = ''; // Numi no sigue invitando a la prueba mientras se confirma
    this.declineTimer = setTimeout(() => {
      this.declineTimer = null;
      this.declineReady = true; // la región viva anuncia "Ya puedes elegir."
      this.cdr.markForCheck();
    }, this.declineWaitMs);
    this.focusDiagnosticTitle();
  }

  /** "Volver": de nuevo a la oferta, sin rechazar. */
  cancelDecline(): void {
    this.clearDeclineTimer();
    this.declineStep = null;
    this.declineReady = false;
    this.message = DIAGNOSTIC_MESSAGES.offer;
    this.focusDiagnosticTitle();
  }

  /** Confirmado: se guarda en el servidor. Solo si quedó guardado se da por hecho. */
  async confirmDecline(): Promise<void> {
    const topic = this.topic;
    if (!topic || this.declineBusy || this.diag !== 'offer') return;
    // Solo desde la confirmación ya disponible o desde el error (reintentar).
    const allowed = this.declineStep === 'error' || (this.declineStep === 'confirm' && this.declineReady);
    if (!allowed) return;
    this.declineBusy = true;
    this.cdr.markForCheck(); // "Volver" y "Empezar a practicar igual" se desactivan ya
    let saved = false;
    try {
      await this.practice.declineDiagnostic(this.studentId, topic.id);
      saved = true;
      // Guardado: el tema deja de ofrecer el test ya en la app (sin esperar a recargar los temas).
      this.markDeclined(topic.id);
    } catch {
      // Sin culpa y sin darlo por hecho: reintentar o practicar igual (se ofrecerá más tarde).
      // El foco va al título del error (el botón tocado desaparece); también si falla otra vez.
      this.declineStep = 'error';
      this.message = '';
      this.focusDiagnosticTitle();
    } finally {
      this.declineBusy = false;
      this.cdr.markForCheck();
    }
    // Si mientras tanto cambió la pantalla (otro tema), no se toca lo que el niño ve ahora.
    if (saved && this.topic?.id === topic.id && this.diag === 'offer') await this.startPracticeAnyway();
  }

  private markDeclined(topicId: string): void {
    const off = (t: Topic) => (t.id === topicId ? { ...t, diagnosticAvailable: false } : t);
    this.topics = this.topics.map(off);
    if (this.topic) this.topic = off(this.topic);
  }

  /** Empieza a practicar en el nivel 1, como siempre (si el rechazo no se guardó, el test se
   * vuelve a ofrecer más tarde). */
  async startPracticeAnyway(): Promise<void> {
    if (this.declineBusy) return;
    this.resetDiagnostic();
    await this.next();
  }

  /** Texto de la región viva de la confirmación. */
  get declineStatus(): string {
    // El error no va aquí: lo lee el foco en su título (sin repetirlo).
    return this.declineStep === 'confirm' && this.declineReady ? DIAGNOSTIC_MESSAGES.declineReady : '';
  }

  private clearDeclineTimer(): void {
    if (this.declineTimer !== null) clearTimeout(this.declineTimer);
    this.declineTimer = null;
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
    this.clearDeclineTimer();
    this.declineStep = null;
    this.declineReady = false;
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
    this.saveSheet(); // guarda lo dibujado ANTES de que el papel se limpie para el siguiente ejercicio
    this.sheetTarget = null;
    this.sheetSaved = '';
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
      this.sheetTarget =
        this.offlineMode || this.exercise.offline
          ? null
          : {
              student: this.studentId,
              token: this.exercise.token,
              task: this.taskMode,
              answer: Number(this.answer),
              fraction: this.fractionMode
                ? { num: Number(this.fraction.num), den: Number(this.fraction.den) }
                : null,
            };
      this.sheetSaved = '';
      this.saveSheet(); // solo guarda si hay trazos y un docente vinculado
      this.total += 1;
      // CU-A9: el recordatorio de racha sabe que este perfil ya practicó hoy (solo en el equipo).
      void this.reminders.notePractice(this.studentId);
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
    if (this.paperOpen) this.saveSheet(); // al cerrar el papel
    this.paperOpen = !this.paperOpen;
    if (this.paperOpen) void this.refreshTeacherSees();
  }

  private async refreshTeacherSees(): Promise<void> {
    this.teacherSeesPaper = await this.sheetsEnabled(this.studentId);
    this.cdr.markForCheck();
  }

  /** `sheets.enabled` guardado por perfil: se vuelve a preguntar solo si pasaron más de 5 minutos. */
  private sheetsEnabled(student: string): Promise<boolean> {
    const c = this.sheetsEnabledCache;
    if (c && c.student === student && Date.now() - c.at < SHEETS_ENABLED_TTL_MS) return c.value;
    const value = this.sheets.enabled(student);
    this.sheetsEnabledCache = { student, at: Date.now(), value };
    return value;
  }

  /**
   * Guarda la hoja del ejercicio ya respondido si hay trazos nuevos desde el último guardado (upsert:
   * una por ejercicio). Copia los trazos AHORA y no hace esperar a nadie. Nunca lanza ni avisa al niño.
   */
  private saveSheet(): void {
    const target = this.sheetTarget;
    const strokes = this.paper?.snapshot();
    if (!target || !strokes) return;
    const signature = JSON.stringify(strokes);
    if (signature === this.sheetSaved) return;
    this.sheetSaved = signature;
    const run = async (): Promise<void> => {
      let saved = false;
      try {
        // Sin docente vinculado el dibujo no sale del dispositivo.
        if (await this.sheetsEnabled(target.student)) {
          saved = target.task
            ? await this.sheets.saveTask(target.student, target.token, target.answer, strokes)
            : target.fraction
              ? await this.sheets.savePractice(
                  target.student,
                  target.token,
                  target.fraction.num,
                  target.fraction.den,
                  strokes,
                )
              : await this.sheets.savePractice(target.student, target.token, target.answer, null, strokes);
        }
      } catch {
        saved = false;
      }
      // Si no se guardó, el próximo disparador (siguiente o cerrar) lo vuelve a intentar.
      if (!saved && this.sheetTarget === target && this.sheetSaved === signature) this.sheetSaved = '';
    };
    this.sheetQueue = this.sheetQueue.then(run);
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
    // La lista de juegos se pide una vez (para "Más juegos" y "Aprender jugando").
    void this.loadTopicGames();
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
