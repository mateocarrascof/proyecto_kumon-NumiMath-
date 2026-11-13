import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AssignmentsPort, TutorError } from '../core/assignments/assignments.port';
import { ConfettiComponent } from '../core/celebration/confetti.component';
import {
  ExplanationError,
  ExplanationPort,
  ExplanationRequest,
} from '../core/explanation/explanation.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { SheetsPort, SheetStroke } from '../core/sheets/sheets.port';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { Exercise, PracticeError, PracticePort, Topic } from '../core/practice/practice.port';
import { EmojiRowsComponent } from '../core/games/emoji-rows.component';
import { GameGroup, GamesPort } from '../core/games/games.port';
import { Progress, ProgressPort } from '../core/progress/progress.port';
import { ScratchpadComponent } from '../core/scratchpad/scratchpad.component';
import { FractionInputComponent } from '../core/math/fraction-input.component';
import { MathTextComponent } from '../core/math/math-text.component';
import { GentleTimerComponent } from '../core/timer/gentle-timer.component';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { MemoryOfflineStore } from '../core/offline/memory-offline-store';
import { OfflineBatch } from '../core/offline/offline.model';
import { OfflineBatchPort } from '../core/offline/offline-batch.port';
import { solutionHash } from '../core/offline/offline-grading';
import { OFFLINE_MESSAGES, OfflineNoticeComponent } from '../core/offline/offline-notice.component';
import { OfflineStore } from '../core/offline/offline-store.port';
import { OfflineSyncError, OfflineSyncPort } from '../core/offline/offline-sync.port';
import { EXPLAIN_MESSAGES, PracticePage, topicIcon } from './practice.page';
import { SkillTilesComponent } from './skill-tiles.component';

const TOPIC = { id: 'sumas_hasta_20', label: 'Sumas hasta 20' };
/** Juegos que devuelve el GamesPort falso ("Aprender jugando"); vacío salvo que la prueba diga. */
let gameGroups: GameGroup[] = [];
/** La lista de juegos falla (sin red o error del servidor). */
let gamesFail = false;
beforeEach(() => {
  gameGroups = [];
  gamesFail = false;
});
const EXERCISE: Exercise = {
  token: 'tok',
  topic: TOPIC.id,
  text: '7 + 5 = ?',
  level: 1,
  expiresIn: 600,
};
const BADGE = '[data-testid="streak-badge"]';

const PROGRESS: Progress = {
  total: 0, correct: 0, streak: 0, dailyStreak: 0, practicedToday: false, byTopic: [], recent: [], weeks: [],
};

function setup(
  overrides: Partial<PracticePort> = {},
  progressGet: () => Promise<Progress> = async () => PROGRESS,
  assignmentOverrides: Partial<Record<keyof AssignmentsPort, unknown>> = {},
  query: Record<string, string> = {},
  explain: ExplanationPort['explain'] = async () => undefined,
) {
  const nav = { navigateForward: vi.fn(async () => true) };
  const games = {
    list: vi.fn(async () => {
      if (gamesFail) throw new Error('red');
      return gameGroups;
    }),
  };
  const explainer = { explain: vi.fn(explain) };
  const queryParams = new BehaviorSubject(convertToParamMap(query));
  const progress = { get: vi.fn(progressGet) };
  const assignments = {
    forKid: vi.fn(async () => ({ pending: [] as { id: string; text: string }[], done: [] })),
    answer: vi.fn(async () => ({ correct: true, correctAnswer: 7 })),
    start: vi.fn(async (_s: string, id: string) => `ticket-${id}`),
    all: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    ...assignmentOverrides,
  };
  const sheets = {
    enabled: vi.fn(async (..._args: unknown[]) => true),
    savePractice: vi.fn(async (..._args: unknown[]) => true),
    saveTask: vi.fn(async (..._args: unknown[]) => true),
  };
  const port = {
    topics: vi.fn(async () => [TOPIC]),
    newExercise: vi.fn(async () => EXERCISE),
    answer: vi.fn(async () => ({ correct: true, correctAnswer: 12 })),
    ...overrides,
  };
  TestBed.configureTestingModule({
    declarations: [
      PracticePage,
      SkillTilesComponent,
      MascotComponent,
      ConfettiComponent,
      ScratchpadComponent,
      GentleTimerComponent,
      MathTextComponent,
      FractionInputComponent,
    ],
    imports: [IonicModule.forRoot(), FormsModule, OfflineNoticeComponent, EmojiRowsComponent],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: PracticePort, useValue: port },
      { provide: ProgressPort, useValue: progress },
      { provide: SheetsPort, useValue: sheets },
      { provide: AssignmentsPort, useValue: assignments },
      { provide: NavController, useValue: nav },
      { provide: GamesPort, useValue: games },
      { provide: ExplanationPort, useValue: explainer },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: { get: () => 'perfil-1' } },
          queryParamMap: queryParams,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(PracticePage);
  return {
    games,
    page: fixture.componentInstance,
    fixture,
    port,
    progress,
    assignments,
    nav,
    queryParams,
    explainer,
    sheets,
  };
}

function query(fixture: { nativeElement: unknown }, selector: string): Element | null {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe('PracticePage', () => {
  it('carga los temas del perfil', async () => {
    const { page, port } = setup();
    await page.ngOnInit();
    expect(port.topics).toHaveBeenCalledWith('perfil-1');
    expect(page.topics).toEqual([TOPIC]);
  });

  it('al elegir un tema pide un ejercicio', async () => {
    const { page, port } = setup();
    await page.ngOnInit();
    await page.choose(TOPIC);
    expect(port.newExercise).toHaveBeenCalledWith('perfil-1', TOPIC.id);
    expect(page.exercise?.text).toBe('7 + 5 = ?');
  });

  it('contar: los emoji van juntos en filas de 5, arriba, y la pregunta sola debajo', async () => {
    const text = '⚽⚽⚽⚽⚽ ⚽⚽⚽⚽ ¿Cuántas pelotas hay?';
    const { page, fixture } = setup({ newExercise: vi.fn(async () => ({ ...EXERCISE, text })) });
    await page.ngOnInit();
    await page.choose(TOPIC);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const block = el.querySelector('[data-testid="emoji-block"]')!;
    expect(block.getAttribute('aria-label')).toBe('9 pelotas'); // sin leer cada emoji
    expect(block.querySelectorAll('.cell').length).toBe(9);
    const question = el.querySelector('[data-testid="exercise-text"]')!;
    expect(question.textContent?.trim()).toBe('¿Cuántas pelotas hay?'); // ningún emoji suelto
    expect(question.classList).toContain('ion-text-center');
  });

  it('un ejercicio sin emoji no muestra el bloque', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    await page.choose(TOPIC);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="emoji-block"]')).toBeNull();
  });

  it('la respuesta solo admite dígitos', async () => {
    const { page } = setup();
    page.onAnswerInput('1a2-3 ');
    expect(page.answer).toBe('123');
    page.onAnswerInput('12345678901');
    expect(page.answer).toHaveLength(7);
  });

  it('una respuesta correcta suma, alegra a la mascota y no se puede enviar dos veces', async () => {
    const { page, port } = setup();
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('12');
    await page.submit();
    expect(port.answer).toHaveBeenCalledWith('perfil-1', 'tok', 12);
    expect(page.correctCount).toBe(1);
    expect(TestBed.inject(MascotPort).state()).toBe('happy');
    expect(page.canSubmit).toBe(false);
    await page.submit();
    expect(port.answer).toHaveBeenCalledTimes(1);
  });

  it('una respuesta incorrecta no pone triste a Numi (piensa contigo) y no suma', async () => {
    const { page } = setup({
      answer: vi.fn(async () => ({ correct: false, correctAnswer: 12 })),
    });
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('11');
    await page.submit();
    expect(page.correctCount).toBe(0);
    expect(page.total).toBe(1);
    expect(TestBed.inject(MascotPort).state()).toBe('thinking');
  });

  it('si el ejercicio venció, avisa y pide otro automáticamente', async () => {
    const { page, port } = setup({
      answer: vi.fn(async () => {
        throw new PracticeError('expired');
      }),
    });
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('12');
    await page.submit();
    expect(port.newExercise).toHaveBeenCalledTimes(2);
  });

  it('un 401 pide ayuda a un adulto, no dice que falta acceso al perfil', async () => {
    const { page } = setup({
      topics: vi.fn(async () => {
        throw new PracticeError('session');
      }),
    });
    await page.ngOnInit();
    expect(page.error).toBe('Pide ayuda a un adulto para volver a entrar.');
  });

  it('si no hay red, pasa al modo sin conexión con un aviso amable (CU-A12)', async () => {
    const { page } = setup({
      topics: vi.fn(async () => {
        throw new PracticeError('network');
      }),
    });
    await page.ngOnInit();
    // Sin lote descargado: no es un error, es un aviso de qué hace falta.
    expect(page.offlineMode).toBe(true);
    expect(page.error).toBe('');
    expect(page.offlineNotice).toBe(OFFLINE_MESSAGES.noBatch);
    expect(page.loading).toBe(false);
  });

  it('si el servidor responde 403 (perfil en pausa o revocado en otro equipo), borra lo guardado sin conexión', async () => {
    const store = new MemoryOfflineStore();
    const nowS = Math.floor(Date.now() / 1000);
    await store.saveProfiles(
      [{ id: 'perfil-1', nickname: 'Ana', grade: 2, blocked: false }],
      { tutorId: 't', savedAt: nowS },
    );
    await store.saveBatch({
      studentId: 'perfil-1', salt: 's', issuedAt: nowS, expiresAt: nowS + 3600, topics: [], exercises: [],
    });
    TestBed.overrideProvider(OfflineStore, { useValue: store });
    const { page } = setup({
      topics: vi.fn(async () => {
        throw new PracticeError('forbidden');
      }),
    });
    await page.ngOnInit();
    expect(await store.batch('perfil-1')).toBeNull();
    expect(await store.profiles()).toEqual([]);
  });

  it('un error que no es 403 (servicio caído) no borra lo guardado', async () => {
    const store = new MemoryOfflineStore();
    const nowS = Math.floor(Date.now() / 1000);
    await store.saveBatch({
      studentId: 'perfil-1', salt: 's', issuedAt: nowS, expiresAt: nowS + 3600, topics: [], exercises: [],
    });
    TestBed.overrideProvider(OfflineStore, { useValue: store });
    const { page } = setup({
      topics: vi.fn(async () => {
        throw new PracticeError('unavailable');
      }),
    });
    await page.ngOnInit();
    expect(await store.batch('perfil-1')).not.toBeNull();
  });

  it('CU-A13: si con red no se pudo enviar la cola, avisa sin culpa y sigue en línea', async () => {
    const store = new MemoryOfflineStore();
    store.attempts.push({
      id: 'a1', studentId: 'perfil-1', token: 't', topic: '2-06', level: 1, answer: 1,
      correct: true, answeredAt: '', localDate: '2026-11-12', durationS: null, expiresAt: 0,
    });
    TestBed.overrideProvider(OfflineStore, { useValue: store });
    TestBed.overrideProvider(OfflineSyncPort, {
      useValue: {
        send: async () => {
          throw new OfflineSyncError('retry'); // 5xx
        },
      },
    });
    const { page, port } = setup();
    await page.ngOnInit();
    expect(page.offlineMode).toBe(false);
    expect(port.topics).toHaveBeenCalled();
    expect(page.offlineNotice).toBe(OFFLINE_MESSAGES.syncPending);
    expect(await store.queue('perfil-1')).toHaveLength(1);
  });

  it('CU-A13: con red, envía la cola ANTES de leer el progreso', async () => {
    const store = new MemoryOfflineStore();
    store.attempts.push({
      id: 'a1', studentId: 'perfil-1', token: 't', topic: '2-06', level: 1, answer: 1,
      correct: true, answeredAt: '', localDate: '2026-11-12', durationS: null, expiresAt: 0,
    });
    const send = vi.fn(async () => [{ id: 'a1', status: 'accepted' as const }]);
    TestBed.overrideProvider(OfflineStore, { useValue: store });
    TestBed.overrideProvider(OfflineSyncPort, { useValue: { send } });
    const { page, port } = setup();
    await page.ngOnInit();
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(port.topics).mock.invocationCallOrder[0],
    );
    expect(await store.queue('perfil-1')).toEqual([]);
    expect(page.offlineNotice).toBe('');
  });

  it('si el guard no abre las tareas por falta de conexión, avisa "Esto necesita internet"', async () => {
    const { page, nav } = setup();
    await page.ngOnInit();
    nav.navigateForward.mockResolvedValue(false);
    TestBed.inject(ConnectivityService).reportNetworkFailure();
    expect(await page.openTasks()).toBe(false);
    expect(nav.navigateForward).toHaveBeenCalledWith(['/tareas', 'perfil-1']);
    expect(page.offlineNotice).toBe(OFFLINE_MESSAGES.needsInternet);
  });

  it.each(['session', 'forbidden', 'network', 'unavailable', 'expired'] as const)(
    'el error %s le habla al niño, sin palabras técnicas',
    async (code) => {
      const { page } = setup({
        topics: vi.fn(async () => {
          throw new PracticeError(code);
        }),
      });
      await page.ngOnInit();
      expect(page.error).not.toMatch(/servidor|sesión|acceso|encendido/i);
    },
  );

  it('elige un símbolo por tema y uno por defecto si no reconoce el id', () => {
    expect(topicIcon('Sumas hasta 20')).toBe('+');
    expect(topicIcon('Sumar y restar fracciones de igual denominador')).toBe('½');
    expect(topicIcon('División como reparto y agrupación')).toBe('÷');
    expect(topicIcon('restas_con_canje')).toBe('−');
    expect(topicIcon('multiplicacion_dos_cifras')).toBe('×');
    expect(topicIcon('tablas_del_2_5_10')).toBe('×');
    expect(topicIcon('division_con_resto')).toBe('÷');
    expect(topicIcon('fracciones_equivalentes')).toBe('½');
    expect(topicIcon('tema_nuevo')).toBe('★');
  });

  it('la racha sube con cada acierto, da medalla a las 5 y vuelve a 0 al fallar', async () => {
    let correct = true;
    const { page } = setup({
      answer: vi.fn(async () => ({ correct, correctAnswer: 12 })),
    });
    await page.ngOnInit();
    await page.choose(TOPIC);
    for (let i = 0; i < 5; i++) {
      page.onAnswerInput('12');
      await page.submit();
      if (i < 4) await page.next();
    }
    expect(page.streak).toBe(5);
    expect(page.medals).toBe(1);
    expect(page.medalNow).toBe(true);
    expect(page.filledStars).toBe(5);
    expect(page.confetti).toBe(5);

    await page.next();
    correct = false;
    page.onAnswerInput('3');
    await page.submit();
    expect(page.streak).toBe(0);
    expect(page.filledStars).toBe(0);
    expect(page.medals).toBe(1);
  });

  it('muestra los días seguidos al entrar', async () => {
    const { page } = setup({}, async () => ({ ...PROGRESS, dailyStreak: 4, practicedToday: true }));
    await page.ngOnInit();
    expect(page.dailyStreak).toBe(4);
  });

  it('si la racha de días no carga, la práctica sigue sin error', async () => {
    const { page } = setup({}, async () => {
      throw new PracticeError('network');
    });
    await page.ngOnInit();
    expect(page.error).toBe('');
    expect(page.topics).toEqual([TOPIC]);
    expect(page.dailyStreak).toBe(0);
  });

  it('la primera respuesta del día celebra los días seguidos una sola vez', async () => {
    const days = [
      { ...PROGRESS, dailyStreak: 2, practicedToday: false },
      { ...PROGRESS, dailyStreak: 3, practicedToday: true },
    ];
    const { page } = setup({}, async () => days.shift() ?? days[0]);
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('12');
    await page.submit();
    await new Promise((r) => setTimeout(r, 0));
    expect(page.dailyStreak).toBe(3);
    expect(page.dayStreakNow).toBe(true);

    await page.next();
    expect(page.dayStreakNow).toBe(false);
    page.onAnswerInput('12');
    await page.submit();
    await new Promise((r) => setTimeout(r, 0));
    expect(page.dayStreakNow).toBe(false);
    expect(page.dailyStreak).toBe(3);
  });

  it('una respuesta incorrecta también cuenta para el día', async () => {
    const days = [
      { ...PROGRESS, dailyStreak: 0, practicedToday: false },
      { ...PROGRESS, dailyStreak: 1, practicedToday: true },
    ];
    const { page } = setup(
      { answer: vi.fn(async () => ({ correct: false, correctAnswer: 12 })) },
      async () => days.shift() ?? days[0],
    );
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('11');
    await page.submit();
    await new Promise((r) => setTimeout(r, 0));
    expect(page.dailyStreak).toBe(1);
    expect(page.dayStreakNow).toBe(true);
  });

  it('la racha de días se ve en la barra al elegir tema, también con 0', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const badge = query(fixture, BADGE);
    expect(badge?.textContent).toContain('0');
    expect(badge?.getAttribute('aria-label')).toBe('Racha: 0 días seguidos');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      '¡Responde un ejercicio hoy para empezar tu racha de días!',
    );
  });

  it('la racha sigue en la barra durante los ejercicios', async () => {
    const { page, fixture } = setup({}, async () => ({
      ...PROGRESS,
      dailyStreak: 4,
      practicedToday: true,
    }));
    await page.ngOnInit();
    await page.choose(TOPIC);
    fixture.detectChanges();
    const badge = query(fixture, BADGE);
    expect(badge?.textContent).toContain('4');
    expect(badge?.classList).toContain('today');
  });

  it('si la racha no carga, no se muestra la insignia', async () => {
    const { page, fixture } = setup({}, async () => {
      throw new PracticeError('network');
    });
    await page.ngOnInit();
    fixture.detectChanges();
    expect(query(fixture, BADGE)).toBeNull();
  });

  it('muestra el nivel del ejercicio y celebra solo cuando sube', async () => {
    const levels: Exercise['level'][] = [2, 2, 3, 2];
    const { page, fixture } = setup({
      newExercise: vi.fn(async () => ({ ...EXERCISE, level: levels.shift() ?? 1 })),
    });
    await page.ngOnInit();
    await page.choose(TOPIC);
    // El primer ejercicio del tema no celebra aunque venga en nivel 2 (nivel guardado).
    expect(page.levelUpNow).toBe(false);
    fixture.detectChanges();
    const level = query(fixture, '[data-testid="level"]');
    expect(level?.getAttribute('aria-label')).toBe('Nivel 2 de 3');
    expect(level?.textContent).toContain('★★☆');

    await page.next();
    expect(page.levelUpNow).toBe(false);
    const confetti = page.confetti;
    await page.next();
    expect(page.levelUpNow).toBe(true);
    expect(page.confetti).toBe(confetti + 1);
    expect(TestBed.inject(MascotPort).state()).toBe('happy');
    // Bajar de nivel no se anuncia.
    await page.next();
    expect(page.levelUpNow).toBe(false);
  });

  it('al cambiar de tema no celebra el nivel del tema nuevo', async () => {
    const levels: Exercise['level'][] = [1, 3];
    const { page } = setup({
      newExercise: vi.fn(async () => ({ ...EXERCISE, level: levels.shift() ?? 1 })),
    });
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.changeTopic();
    await page.choose({ id: 'restas_hasta_20', label: 'Restas' });
    expect(page.exercise?.level).toBe(3);
    expect(page.levelUpNow).toBe(false);
  });

  it('el papel para calcular se abre y se cierra', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    await page.choose(TOPIC);
    fixture.detectChanges();
    expect(query(fixture, 'app-scratchpad')).toBeNull();
    const toggle = query(fixture, '.paper-toggle') as HTMLElement;
    toggle.click();
    fixture.detectChanges();
    expect(page.paperOpen).toBe(true);
    expect(query(fixture, 'app-scratchpad')).not.toBeNull();
    expect(toggle.textContent).toContain('Cerrar el papel');
    expect(query(fixture, '.paper-save')).toBeNull(); // sin botón: la hoja se guarda sola
    toggle.click();
    fixture.detectChanges();
    expect(query(fixture, 'app-scratchpad')).toBeNull();
  });

  describe('hoja del papel (CU-A22)', () => {
    const INK: SheetStroke[] = [
      { eraser: false, color: '#2b2d42', width: 4, points: [[10, 10], [40, 40]] },
    ];

    async function withPaper(inked: boolean, overrides: Partial<PracticePort> = {}, linked = true) {
      const ctx = setup(overrides);
      ctx.sheets.enabled.mockResolvedValue(linked);
      await ctx.page.ngOnInit();
      await ctx.page.choose(TOPIC);
      ctx.fixture.detectChanges();
      (query(ctx.fixture, '.paper-toggle') as HTMLElement).click();
      ctx.fixture.detectChanges();
      const pad = ctx.fixture.debugElement.query(By.directive(ScratchpadComponent))
        .componentInstance as ScratchpadComponent;
      const snapshot = vi.spyOn(pad, 'snapshot').mockReturnValue(inked ? INK : null);
      return { ...ctx, snapshot };
    }
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const MORE_INK: SheetStroke[] = [
      ...INK,
      { eraser: false, color: '#1d4ed8', width: 4, points: [[5, 5], [9, 9]] },
    ];

    it('al responder con trazos la hoja se guarda sola, con la respuesta escrita', async () => {
      const { page, sheets } = await withPaper(true);
      page.onAnswerInput('12');
      await page.submit();
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledWith('perfil-1', EXERCISE.token, 12, null, INK);
    });

    it('responde, LUEGO dibuja y pulsa "Siguiente": la hoja con lo nuevo se guarda', async () => {
      const { page, sheets, snapshot } = await withPaper(false);
      page.onAnswerInput('12');
      await page.submit();
      await flush();
      expect(sheets.savePractice).not.toHaveBeenCalled(); // al responder el papel estaba vacío
      snapshot.mockReturnValue(INK); // dibuja después de responder
      await page.next();
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledTimes(1);
      expect(sheets.savePractice).toHaveBeenCalledWith('perfil-1', EXERCISE.token, 12, null, INK);
    });

    it('al cerrar el papel guarda si hay trazos nuevos, y no repite si no hay nada nuevo', async () => {
      const { page, sheets, snapshot } = await withPaper(true);
      page.onAnswerInput('12');
      await page.submit();
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledTimes(1);
      page.togglePaper(); // cerrar: mismos trazos que ya se guardaron
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledTimes(1);
      page.togglePaper(); // abrir
      snapshot.mockReturnValue(MORE_INK);
      page.togglePaper(); // cerrar con trazos nuevos
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledTimes(2);
      expect(sheets.savePractice).toHaveBeenLastCalledWith('perfil-1', EXERCISE.token, 12, null, MORE_INK);
    });

    it('"Siguiente" sin trazos nuevos no vuelve a guardar', async () => {
      const { page, sheets } = await withPaper(true);
      page.onAnswerInput('12');
      await page.submit();
      await page.next();
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledTimes(1);
    });

    it('pasar a "Siguiente" no espera al guardado', async () => {
      const { page, sheets } = await withPaper(true);
      sheets.savePractice.mockReturnValue(new Promise<boolean>(() => undefined)); // nunca termina
      page.onAnswerInput('12');
      await page.submit();
      await page.next(); // si esperara el guardado, esta línea no volvería
      expect(page.result).toBeNull();
      expect(page.error).toBe('');
    });

    it('pulsar "Siguiente" rápido no duplica guardados y salen en orden (el upsert deja el último)', async () => {
      const { page, sheets, snapshot } = await withPaper(true);
      const order: SheetStroke[][] = [];
      let release: (v: boolean) => void = () => undefined;
      sheets.enabled.mockReturnValue(new Promise<boolean>((r) => (release = r)));
      sheets.savePractice.mockImplementation(async (...args: unknown[]) => {
        order.push(args[4] as SheetStroke[]);
        return true;
      });
      page.onAnswerInput('12');
      await page.submit(); // guardado 1 queda esperando a `enabled`
      snapshot.mockReturnValue(MORE_INK);
      page.togglePaper(); // cerrar con trazos nuevos: guardado 2
      page.togglePaper();
      page.togglePaper(); // mismos trazos: no duplica
      await page.next(); // mismos trazos: no duplica
      release(true);
      await flush();
      expect(order).toEqual([INK, MORE_INK]);
      expect(sheets.enabled).toHaveBeenCalledTimes(1);
    });

    it('si el guardado falla, no hay aviso y el siguiente disparador lo reintenta', async () => {
      const { page, fixture, sheets } = await withPaper(true);
      sheets.savePractice.mockResolvedValueOnce(false);
      page.onAnswerInput('12');
      await page.submit();
      await flush();
      fixture.detectChanges();
      expect(page.result?.correct).toBe(true);
      expect(page.error).toBe('');
      expect(query(fixture, '[data-testid="sheet-notice"]')).toBeNull();
      await page.next();
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledTimes(2);
    });

    it('sin trazos no guarda nada', async () => {
      const { page, sheets } = await withPaper(false);
      page.onAnswerInput('12');
      await page.submit();
      await page.next();
      page.togglePaper();
      await flush();
      expect(sheets.savePractice).not.toHaveBeenCalled();
    });

    it('con el papel cerrado no guarda nada', async () => {
      const { page, sheets } = setup();
      await page.ngOnInit();
      await page.choose(TOPIC);
      page.onAnswerInput('12');
      await page.submit();
      await flush();
      expect(sheets.savePractice).not.toHaveBeenCalled();
    });

    it('sin docente vinculado no se sube nada y no se muestra ningún aviso', async () => {
      const { page, fixture, sheets } = await withPaper(true, {}, false);
      page.onAnswerInput('12');
      await page.submit();
      await page.next();
      await flush();
      fixture.detectChanges();
      expect(sheets.enabled).toHaveBeenCalledWith('perfil-1');
      expect(sheets.savePractice).not.toHaveBeenCalled();
      expect(page.result).toBeNull();
      expect(page.error).toBe('');
      expect(query(fixture, '[data-testid="paper-teacher-note"]')).toBeNull();
    });

    it('el texto "Tu profe puede ver este papel" sale con docente vinculado', async () => {
      const { fixture } = await withPaper(true);
      await flush();
      fixture.detectChanges();
      expect(query(fixture, '[data-testid="paper-teacher-note"]')?.textContent).toContain(
        'Tu profe puede ver este papel',
      );
    });

    it('el texto no sale sin docente vinculado', async () => {
      const ctx = setup();
      ctx.sheets.enabled.mockResolvedValue(false);
      await ctx.page.ngOnInit();
      await ctx.page.choose(TOPIC);
      ctx.fixture.detectChanges();
      (query(ctx.fixture, '.paper-toggle') as HTMLElement).click();
      await flush();
      ctx.fixture.detectChanges();
      expect(query(ctx.fixture, 'app-scratchpad')).not.toBeNull();
      expect(query(ctx.fixture, '[data-testid="paper-teacher-note"]')).toBeNull();
    });

    it('`sheets.enabled` se pregunta una vez por perfil, no en cada ejercicio', async () => {
      const { page, sheets, snapshot } = await withPaper(true);
      for (let i = 0; i < 3; i++) {
        snapshot.mockReturnValue([...INK, { eraser: false, color: '#000', width: 4, points: [[i, i]] }]);
        page.onAnswerInput('12');
        await page.submit();
        await page.next();
      }
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledTimes(3);
      expect(sheets.enabled).toHaveBeenCalledTimes(1);
    });

    it('lo que se guarda es la respuesta del ejercicio aunque el niño ya escriba otra', async () => {
      const { page, sheets } = await withPaper(true);
      let release: (v: boolean) => void = () => undefined;
      sheets.enabled.mockReturnValue(new Promise<boolean>((r) => (release = r)));
      page.onAnswerInput('12');
      await page.submit();
      page.answer = '99';
      release(true);
      await flush();
      expect(sheets.savePractice).toHaveBeenCalledWith('perfil-1', EXERCISE.token, 12, null, INK);
    });

    it('sin conexión (modo sin conexión de CU-A12) no se guarda ni se encola', async () => {
      const { page, sheets } = await withPaper(true);
      page.offlineMode = true;
      page.onAnswerInput('12');
      await page.submit();
      await page.next();
      await flush();
      expect(sheets.savePractice).not.toHaveBeenCalled();
    });
  });

  it('el botón de tareas se ve siempre, aunque no haya tareas, y abre su pantalla', async () => {
    const { page, fixture, nav } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const card = query(fixture, '[data-testid="tasks-card"]') as HTMLElement;
    expect(card.textContent).toContain('Tareas de tu tutor');
    card.click();
    expect(nav.navigateForward).toHaveBeenCalledWith(['/tareas', 'perfil-1']);
  });

  it('desde la pantalla de tareas arranca en modo tareas por la elegida', async () => {
    const { page } = setup(
      {},
      undefined,
      {
        forKid: vi.fn(async () => ({
          pending: [
            { id: 't1', text: '1 + 1 = ?' },
            { id: 't2', text: '2 + 2 = ?' },
          ],
          done: [],
        })),
      },
      { tareas: '1', desde: 't2' },
    );
    await page.ngOnInit();
    await new Promise((r) => setTimeout(r, 0));
    expect(page.taskMode).toBe(true);
    expect(page.exercise?.token).toBe('t2');
    expect(page.tasks.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('las tareas del tutor aparecen arriba de los temas y se responden una por una', async () => {
    const { page, fixture, port, assignments } = setup({}, undefined, {
      forKid: vi.fn(async () => ({
        pending: [
          { id: 't1', text: 'Tienes 3 y te dan 4. ¿Cuántos tienes?' },
          { id: 't2', text: '10 − 2 = ?' },
        ],
        done: [],
      })),
    });
    await page.ngOnInit();
    fixture.detectChanges();
    expect(query(fixture, '[data-testid="tasks-card"]')?.textContent).toContain('2');

    await page.chooseTasks();
    expect(page.taskMode).toBe(true);
    expect(page.exercise?.text).toContain('Tienes 3');
    expect(port.newExercise).not.toHaveBeenCalled();
    fixture.detectChanges();
    // Las tareas no muestran nivel.
    expect(query(fixture, '[data-testid="level"]')).toBeNull();

    page.onAnswerInput('7');
    await page.submit();
    // Manda el ticket de la tarea para que el servidor mida el tiempo.
    expect(assignments.answer).toHaveBeenCalledWith('perfil-1', 't1', 7, 'ticket-t1');
    expect(page.result?.correct).toBe(true);
    expect(page.correctCount).toBe(1);

    await page.next();
    expect(page.exercise?.text).toBe('10 − 2 = ?');
    page.onAnswerInput('8');
    await page.submit();
    await page.next();
    expect(page.exercise).toBeNull();
    expect(page.tasksDone).toBe(true);
    expect(page.tasks).toEqual([]);
  });

  it('una tarea ya respondida en otro lado se salta', async () => {
    const { page } = setup({}, undefined, {
      forKid: vi.fn(async () => ({
        pending: [
          { id: 't1', text: '1 + 1 = ?' },
          { id: 't2', text: '2 + 2 = ?' },
        ],
        done: [],
      })),
      answer: vi.fn(async () => {
        throw new TutorError('already_answered');
      }),
    });
    await page.ngOnInit();
    await page.chooseTasks();
    page.onAnswerInput('2');
    await page.submit();
    expect(page.exercise?.token).toBe('t2');
  });

  it('si las tareas no cargan, la práctica sigue normal', async () => {
    const { page } = setup({}, undefined, {
      forKid: vi.fn(async () => {
        throw new TutorError('network');
      }),
    });
    await page.ngOnInit();
    expect(page.error).toBe('');
    expect(page.tasks).toEqual([]);
    expect(page.topics).toEqual([TOPIC]);
  });

  it('si la práctica ya estaba abierta, entrar a una tarea igual arranca el modo tareas', async () => {
    // Ionic vuelve a la pantalla existente: no se llama otra vez a ngOnInit, solo cambia la dirección.
    // Al abrir había 1 tarea; el tutor agregó otra después: se debe recargar la lista.
    let pending = [{ id: 't1', text: '1 + 1 = ?' }];
    const { page, queryParams } = setup({}, undefined, {
      forKid: vi.fn(async () => ({ pending, done: [] })),
    });
    await page.ngOnInit();
    expect(page.taskMode).toBe(false);
    pending = [...pending, { id: 't2', text: '2 + 2 = ?' }];
    queryParams.next(convertToParamMap({ tareas: '1', desde: 't2', n: '1' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(page.taskMode).toBe(true);
    expect(page.exercise?.token).toBe('t2');
  });

  it('el ejercicio muestra el reloj amable', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    await page.choose(TOPIC);
    fixture.detectChanges();
    expect(query(fixture, '[data-testid="gentle-timer"]')?.textContent).toContain('0:00');
  });

  it('si no se puede pedir el ticket, la tarea se responde igual (sin tiempo)', async () => {
    const { page, assignments } = setup({}, undefined, {
      forKid: vi.fn(async () => ({ pending: [{ id: 't1', text: '1 + 1 = ?' }], done: [] })),
      start: vi.fn(async () => {
        throw new TutorError('network');
      }),
    });
    await page.ngOnInit();
    await page.chooseTasks();
    await new Promise((r) => setTimeout(r, 0));
    page.onAnswerInput('2');
    await page.submit();
    expect(assignments.answer).toHaveBeenCalledWith('perfil-1', 't1', 2, null);
    expect(page.result?.correct).toBe(true);
  });

  describe('habilidades del catálogo', () => {
    const own = (id: string, label: string, module: string, extra: Partial<Topic> = {}): Topic => ({
      id, label, module, grade: 2, review: false, level: 1, blockDone: 0, blockSize: 10,
      mastered: false, ...extra,
    });

    it('agrupa por eje y deja el repaso plegado', async () => {
      const topics = [
        own('2-07', 'Sumas hasta 100 sin reserva', 'Números y operaciones', { level: 2 }),
        own('2-15', 'Patrones numéricos', 'Patrones y álgebra', { mastered: true }),
        own('1-06', 'Sumas hasta 10', 'Números y operaciones', { grade: 1, review: true }),
      ];
      const { fixture, page } = setup({ topics: vi.fn(async () => topics) });
      await page.ngOnInit();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const groups = [...el.querySelectorAll('[data-testid="skill-group"]')];
      expect(groups.map((g) => g.querySelector('.group-name')?.textContent?.trim())).toEqual([
        'Números y operaciones',
        'Patrones y álgebra',
      ]);
      // Cada eje con su color fijo (no rota por posición).
      expect(groups.map((g) => g.getAttribute('data-tone'))).toEqual(['teal', 'lilac']);
      const tiles = [...el.querySelectorAll('[data-testid="topic-tile"]')];
      expect(tiles.map((t) => t.getAttribute('data-tone'))).toEqual(['teal', 'lilac']);
      // Avance visible y leído por el lector de pantalla.
      expect(tiles[0].getAttribute('aria-label')).toBe(
        'Sumas hasta 100 sin reserva, nivel 2 de 3, 0 de 10 ejercicios',
      );
      expect(tiles[0].textContent).toContain('★★☆');
      expect(tiles[0].textContent).toContain('0/10');
      expect(tiles[1].querySelector('[data-testid="tile-mastered"]')?.textContent).toContain('Dominada');
      expect(tiles[1].getAttribute('aria-label')).toBe('Patrones numéricos, dominada');
      expect(groups[1].querySelector('.group-count')?.textContent?.trim()).toBe('1 de 1 dominadas');
      expect(el.querySelector('[data-testid="review-list"]')).toBeNull();
      (el.querySelector('[data-testid="review-toggle"]') as HTMLElement).click();
      fixture.detectChanges();
      const review = el.querySelector('[data-testid="review-list"]') as HTMLElement;
      expect(review.textContent).toContain('Repaso de 1° básico');
      expect(review.textContent).toContain('Sumas hasta 10');
      expect(review.querySelector('.tile-grade')?.textContent?.trim()).toBe('1°');
      expect(review.querySelector('[data-testid="topic-tile"]')?.getAttribute('aria-label')).toContain(
        'repaso de 1° básico',
      );
    });

    it('la barrita del bloque muestra el avance', () => {
      const tiles = new SkillTilesComponent();
      const percent = (t: Partial<Topic>) => tiles.percent(t as Topic);
      expect(percent({ blockDone: 3, blockSize: 10 })).toBe(30);
      expect(percent({ blockDone: 12, blockSize: 10 })).toBe(100);
      expect(percent({})).toBe(0);
    });

    it('el marcador de la sesión aparece recién con la primera respuesta', async () => {
      const { fixture, page } = setup();
      await page.ngOnInit();
      await page.choose(TOPIC);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.score')).toBeNull();
      page.onAnswerInput('12');
      await page.submit();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.score')?.textContent).toContain('1 de 1 correctas');
    });

    it('muestra el ejercicio del bloque y celebra al dominar', async () => {
      const first = { ...EXERCISE, level: 3 as const, blockDone: 9, mastered: false };
      const second = { ...EXERCISE, token: 'tok2', level: 3 as const, blockDone: 0, mastered: true };
      const newExercise = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      const { fixture, page } = setup({ newExercise });
      await page.ngOnInit();
      await page.choose(TOPIC);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="block"]')?.textContent).toContain('10/10');
      expect(el.querySelector('[data-testid="mastered"]')).toBeNull();
      await page.next();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="mastered"]')?.textContent).toContain('Dominaste');
    });

    it('un ejercicio de fracciones se responde con numerador y denominador', async () => {
      const exercise = { ...EXERCISE, text: '2/5 + 1/5 = ?', answerKind: 'fraction' as const };
      const answer = vi.fn(async () => ({
        correct: true, correctAnswer: 3, correctAnswerDen: 5, simplified: { num: 3, den: 5 },
      }));
      const { fixture, page } = setup({ newExercise: vi.fn(async () => exercise), answer });
      await page.ngOnInit();
      await page.choose(TOPIC);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('[data-testid="exercise-text"] .frac').length).toBe(2);
      expect(el.querySelector('[data-testid="fraction-num"]')).not.toBeNull();
      expect(page.canSubmit).toBe(false);
      page.fraction = { num: '6', den: '0' };
      expect(page.canSubmit).toBe(false); // denominador 0 no se envía
      page.fraction = { num: '6', den: '10' };
      await page.submit();
      fixture.detectChanges();
      expect(answer).toHaveBeenCalledWith('perfil-1', 'tok', 6, 10);
      expect(el.querySelector('[data-testid="simplified"]')).not.toBeNull();
    });
  });
});

describe('PracticePage: explicación de Numi', () => {
  const WRONG = { answer: vi.fn(async () => ({ correct: false, correctAnswer: 12 })) };

  type Explain = ExplanationPort['explain'];
  type Fixture = { nativeElement: unknown };

  /** Ejercicio respondido mal, con la pantalla dibujada. */
  async function wrongAnswer(explain?: Explain) {
    const ctx = setup(WRONG, undefined, {}, {}, explain);
    await ctx.page.ngOnInit();
    await ctx.page.choose(TOPIC);
    ctx.page.onAnswerInput('11');
    await ctx.page.submit();
    ctx.fixture.detectChanges();
    return ctx;
  }

  const button = (fixture: Fixture) => query(fixture, '[data-testid="explain-btn"]');
  const bubble = (fixture: Fixture) => query(fixture, '[data-testid="explain-bubble"]');
  const text = (fixture: Fixture, id: string) =>
    query(fixture, `[data-testid="${id}"]`)?.textContent?.trim();

  it('el botón aparece solo tras una respuesta incorrecta', async () => {
    const ok = setup();
    await ok.page.ngOnInit();
    await ok.page.choose(TOPIC);
    ok.page.onAnswerInput('12');
    await ok.page.submit();
    ok.fixture.detectChanges();
    expect(button(ok.fixture)).toBeNull();
    TestBed.resetTestingModule();

    const { fixture } = await wrongAnswer();
    expect(button(fixture)?.textContent).toContain('Explícame cómo se hace');
    expect(bubble(fixture)?.getAttribute('aria-live')).toBe('polite');
  });

  it('antes de responder no hay botón', async () => {
    const { page, fixture } = setup(WRONG);
    await page.ngOnInit();
    await page.choose(TOPIC);
    fixture.detectChanges();
    expect(button(fixture)).toBeNull();
  });

  it('en las tareas del tutor no hay botón aunque la respuesta sea incorrecta', async () => {
    const { page, fixture, explainer } = setup({}, undefined, {
      forKid: vi.fn(async () => ({ pending: [{ id: 't1', text: '10 − 2 = ?' }], done: [] })),
      answer: vi.fn(async () => ({ correct: false, correctAnswer: 8 })),
    });
    await page.ngOnInit();
    await page.chooseTasks();
    page.onAnswerInput('7');
    await page.submit();
    fixture.detectChanges();
    expect(page.result?.correct).toBe(false);
    expect(page.canExplain).toBe(false);
    expect(button(fixture)).toBeNull();
    await page.explain();
    expect(explainer.explain).not.toHaveBeenCalled();
  });

  it('envía solo el tema y el enunciado del servidor (sin respuesta, apodo ni curso)', async () => {
    const { page, explainer } = await wrongAnswer();
    await page.explain();
    expect(explainer.explain).toHaveBeenCalledTimes(1);
    const [studentId, request] = explainer.explain.mock.calls[0] as unknown as [
      string,
      ExplanationRequest,
    ];
    expect(studentId).toBe('perfil-1');
    expect(request).toEqual({ topic: TOPIC.id, exercise: '7 + 5 = ?' });
    expect(Object.keys(request).sort()).toEqual(['exercise', 'topic']);
  });

  it('muestra "pensando", luego el texto a medida que llega, y no permite dos peticiones', async () => {
    let push!: (t: string) => void;
    let finish!: () => void;
    const explain: Explain = (_s, _r, onChunk) => {
      push = onChunk;
      return new Promise<void>((resolve) => (finish = resolve));
    };
    const { page, fixture, explainer } = await wrongAnswer(explain);
    const mascot = TestBed.inject(MascotPort);

    const pending = page.explain();
    fixture.detectChanges();
    expect(text(fixture, 'explain-loading')).toBe('Numi está pensando…');
    expect(button(fixture)?.getAttribute('aria-disabled')).toBe('true');
    expect(bubble(fixture)?.getAttribute('aria-busy')).toBe('true');
    expect(mascot.state()).toBe('thinking');

    await page.explain(); // segundo toque: se ignora
    expect(explainer.explain).toHaveBeenCalledTimes(1);

    push('¡Vamos a sumar 7 + 5!');
    fixture.detectChanges();
    expect(mascot.state()).toBe('talking');
    expect(text(fixture, 'explain-text')).toBe('¡Vamos a sumar 7 + 5!');
    push('El resultado es 12.');
    fixture.detectChanges();
    expect(text(fixture, 'explain-text')).toBe('¡Vamos a sumar 7 + 5! El resultado es 12.');

    finish();
    await pending;
    fixture.detectChanges();
    expect(page.explainState).toBe('done');
    expect(button(fixture)).toBeNull(); // no se gasta otra explicación del mismo ejercicio
    expect(mascot.state()).toBe('idle');
  });

  it('pasar al siguiente ejercicio cancela la petición y borra el texto', async () => {
    let signal!: AbortSignal;
    let push!: (t: string) => void;
    const explain: Explain = (_s, _r, onChunk, s) => {
      signal = s;
      push = onChunk;
      return new Promise<void>(() => undefined);
    };
    const { page } = await wrongAnswer(explain);
    void page.explain();
    push('Primero.');
    expect(page.explainText).toBe('Primero.');

    await page.next();
    expect(signal.aborted).toBe(true);
    expect(page.explainText).toBe('');
    expect(page.explainState).toBe('idle');
    push('Llega tarde.'); // lo que llegue de la petición vieja se ignora
    expect(page.explainText).toBe('');
  });

  it('salir de la pantalla o cambiar de tema cancela la petición', async () => {
    let signal!: AbortSignal;
    const explain: Explain = (_s, _r, _c, s) => {
      signal = s;
      return new Promise<void>(() => undefined);
    };
    const first = await wrongAnswer(explain);
    void first.page.explain();
    first.page.ionViewWillLeave();
    expect(signal.aborted).toBe(true);
    TestBed.resetTestingModule();

    const second = await wrongAnswer(explain);
    void second.page.explain();
    second.page.changeTopic();
    expect(signal.aborted).toBe(true);
  });

  const failing =
    (error: ExplanationError, before: string[] = []): Explain =>
    async (_s, _r, onChunk) => {
      before.forEach((t) => onChunk(t));
      throw error;
    };

  it.each([
    ['429', new ExplanationError('quota'), EXPLAIN_MESSAGES.quota, false],
    ['503 o red', new ExplanationError('unavailable'), EXPLAIN_MESSAGES.unavailable, true],
    [
      '422',
      new ExplanationError('rejected', 'Yo te ayudo con matemáticas.'),
      'Yo te ayudo con matemáticas.',
      false,
    ],
  ])('%s muestra un mensaje amable y la práctica sigue', async (_name, error, message, retry) => {
    const { page, fixture, port } = await wrongAnswer(failing(error));
    await page.explain();
    fixture.detectChanges();
    expect(text(fixture, 'explain-notice')).toBe(message);
    expect(query(fixture, '[role="alert"]')).toBeNull(); // no es un error de la práctica
    expect(TestBed.inject(MascotPort).state()).toBe('idle'); // Numi no se pone triste
    expect(button(fixture) !== null).toBe(retry);
    await page.next();
    expect(port.newExercise).toHaveBeenCalledTimes(2);
    expect(page.result).toBeNull();
    expect(page.explainNotice).toBe('');
  });

  it('un corte a mitad conserva lo recibido y avisa', async () => {
    const { page, fixture } = await wrongAnswer(
      failing(new ExplanationError('interrupted'), ['Primero suma las unidades.']),
    );
    await page.explain();
    fixture.detectChanges();
    expect(text(fixture, 'explain-text')).toBe('Primero suma las unidades.');
    expect(text(fixture, 'explain-notice')).toBe(EXPLAIN_MESSAGES.interrupted);
    expect(button(fixture)?.textContent).toContain('Intentar otra vez');
  });

  it('un error inesperado del servicio también se muestra como "no pudo"', async () => {
    const { page } = await wrongAnswer(async () => {
      throw new Error('boom');
    });
    await page.explain();
    expect(page.explainNotice).toBe(EXPLAIN_MESSAGES.unavailable);
  });

  it('el texto de la explicación no se guarda en el almacenamiento del navegador', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { page } = await wrongAnswer(async (_s, _r, onChunk) => onChunk('Secreto de prueba.'));
    await page.explain();
    expect(page.explainText).toBe('Secreto de prueba.');
    expect(setItem.mock.calls.some((c) => String(c[1]).includes('Secreto'))).toBe(false);
    setItem.mockRestore();
  });

  it('la explicación se ve en varias líneas, un paso por línea, sin línea vacía al final', async () => {
    const lines = [
      '¡Vamos a sumar 481 + 155!\n',
      'Separa 155 en 100 + 50 + 5.\n',
      'Primero: 481 + 100 = 581\n',
      'Luego: 581 + 50 = 631\n',
      'Al final: 631 + 5 = 636\n',
      '¡Así se llega a 636!\n',
      '¡Tú puedes!',
    ];
    const { page, fixture } = await wrongAnswer(async (_s, _r, onChunk) => lines.forEach((l) => onChunk(l)));
    await page.explain();
    fixture.detectChanges();
    const shown = query(fixture, '[data-testid="explain-text"]')?.textContent ?? '';
    expect(shown.split('\n')).toEqual([
      '¡Vamos a sumar 481 + 155!',
      'Separa 155 en 100 + 50 + 5.',
      'Primero: 481 + 100 = 581',
      'Luego: 581 + 50 = 631',
      'Al final: 631 + 5 = 636',
      '¡Así se llega a 636!',
      '¡Tú puedes!',
    ]);
    // Texto plano: nada se interpreta como HTML.
    expect(query(fixture, '[data-testid="explain-text"]')?.children.length).toBe(0);
  });

  it('"Numi dice:" lo lee el lector de pantalla, antes del texto', async () => {
    const { page, fixture } = await wrongAnswer(async (_s, _r, onChunk) => onChunk('Hola.'));
    await page.explain();
    fixture.detectChanges();
    const region = bubble(fixture) as HTMLElement;
    const name = region.querySelector('.numi-name') as HTMLElement;
    expect(name.textContent?.trim()).toBe('Numi dice:');
    expect(name.closest('[aria-hidden="true"]')).toBeNull();
    expect(region.textContent?.indexOf('Numi dice:')).toBeLessThan(region.textContent?.indexOf('Hola.') ?? -1);
  });
});

describe('PracticePage: aviso tras una respuesta incorrecta', () => {
  const WRONG = { answer: vi.fn(async () => ({ correct: false, correctAnswer: 636 })) };
  const plain = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function wrong(explain?: ExplanationPort['explain']) {
    const ctx = setup(WRONG, undefined, {}, {}, explain);
    await ctx.page.ngOnInit();
    await ctx.page.choose(TOPIC);
    ctx.page.onAnswerInput('600');
    await ctx.page.submit();
    ctx.fixture.detectChanges();
    return ctx;
  }

  it('sin explicación abierta: "Casi" + invitación a ver cómo se hace, sin "Sigue intentando"', async () => {
    const { fixture } = await wrong();
    const result = query(fixture, '.result');
    expect(plain(query(fixture, '[data-testid="result-text"]'))).toBe('Casi. La respuesta era 636.');
    expect(plain(query(fixture, '[data-testid="explain-hint"]'))).toBe('¿Quieres ver cómo se hace? 👇');
    expect(plain(result)).not.toContain('Sigue intentando');
  });

  it('con la explicación abierta: solo el dato, sin "Casi" ni invitación', async () => {
    const { page, fixture } = await wrong(async (_s, _r, onChunk) => onChunk('¡Tú puedes!'));
    await page.explain();
    fixture.detectChanges();
    expect(plain(query(fixture, '[data-testid="result-text"]'))).toBe('La respuesta era 636.');
    expect(query(fixture, '[data-testid="explain-hint"]')).toBeNull();
  });

  it('si la explicación no se pudo dar, vuelve el "Casi." (no queda sin ánimo)', async () => {
    const { page, fixture } = await wrong(async () => {
      throw new ExplanationError('quota');
    });
    await page.explain();
    fixture.detectChanges();
    expect(plain(query(fixture, '[data-testid="result-text"]'))).toBe('Casi. La respuesta era 636.');
    expect(query(fixture, '[data-testid="explain-hint"]')).toBeNull();
  });

  it('en las tareas del tutor no invita a ver la explicación (no la hay)', async () => {
    const { page, fixture } = setup({}, undefined, {
      forKid: vi.fn(async () => ({ pending: [{ id: 't1', text: '10 − 2 = ?' }], done: [] })),
      answer: vi.fn(async () => ({ correct: false, correctAnswer: 8 })),
    });
    await page.ngOnInit();
    await page.chooseTasks();
    page.onAnswerInput('7');
    await page.submit();
    fixture.detectChanges();
    expect(plain(query(fixture, '[data-testid="result-text"]'))).toBe('Casi. La respuesta era 8.');
    expect(query(fixture, '[data-testid="explain-hint"]')).toBeNull();
  });

  it('ningún aviso culpa al niño', async () => {
    const { page, fixture } = await wrong(async (_s, _r, onChunk) => onChunk('Hola.'));
    const before = plain(query(fixture, '.result')).toLowerCase();
    await page.explain();
    fixture.detectChanges();
    const after = plain(query(fixture, '.result')).toLowerCase();
    for (const word of ['mal', 'incorrect', 'fallaste', 'error']) {
      expect(before).not.toMatch(new RegExp(`\\b${word}`));
      expect(after).not.toMatch(new RegExp(`\\b${word}`));
    }
  });
});

describe('PracticePage: Numi baja a explicar', () => {
  const WRONG = { answer: vi.fn(async () => ({ correct: false, correctAnswer: 12 })) };
  const count = (fixture: { nativeElement: unknown }, sel: string) =>
    (fixture.nativeElement as HTMLElement).querySelectorAll(sel).length;

  it('hay una sola Numi: arriba sin explicación, junto a la burbuja al explicar y de vuelta arriba', async () => {
    const scroll = vi.fn();
    const { page, fixture } = setup(WRONG, undefined, {}, {}, async (_s, _r, onChunk) => onChunk('Hola.'));
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('11');
    await page.submit();
    fixture.detectChanges();
    expect(count(fixture, 'app-mascot')).toBe(1);
    expect(count(fixture, '[data-testid="mascot-top"]')).toBe(1);

    const row = query(fixture, '[data-testid="explain-row"]') as HTMLElement;
    row.scrollIntoView = scroll;
    await page.explain();
    fixture.detectChanges();
    expect(count(fixture, 'app-mascot')).toBe(1);
    expect(count(fixture, '[data-testid="mascot-top"]')).toBe(0);
    const explainer = query(fixture, '[data-testid="explain-row"] [data-testid="mascot-explainer"]');
    expect(explainer).not.toBeNull();
    // Numi va antes que su burbuja, en la misma fila.
    expect(explainer?.nextElementSibling?.getAttribute('data-testid')).toBe('explain-bubble');
    expect(scroll).toHaveBeenCalledTimes(1);

    await page.next();
    fixture.detectChanges();
    expect(count(fixture, 'app-mascot')).toBe(1);
    expect(count(fixture, '[data-testid="mascot-top"]')).toBe(1);
  });

  it('si el navegador no sabe desplazar (scrollIntoView), la explicación igual funciona', async () => {
    const { page, fixture } = setup(WRONG, undefined, {}, {}, async (_s, _r, onChunk) => onChunk('Hola.'));
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('11');
    await page.submit();
    fixture.detectChanges();
    const row = query(fixture, '[data-testid="explain-row"]') as unknown as { scrollIntoView?: unknown };
    row.scrollIntoView = undefined;
    await page.explain();
    expect(page.explainState).toBe('done');
  });
});

describe('PracticePage: diagnóstico inicial (CU-A2)', () => {
  const NEW_SKILL: Topic = { id: '1-06', label: 'Sumas hasta 10', diagnosticAvailable: true };
  const diagExercise = (step: number): Exercise => ({
    token: `d${step}`,
    topic: NEW_SKILL.id,
    text: `${step} + 1 = ?`,
    level: (Math.floor(step / 2) + 1) as 1 | 2 | 3,
    expiresIn: 600,
  });

  function diagSetup(overrides: Partial<PracticePort> = {}) {
    return setup({
      topics: vi.fn(async () => [NEW_SKILL]),
      diagnosticExercise: vi.fn(async (_s: string, _t: string, step: number) => diagExercise(step)),
      submitDiagnostic: vi.fn(async () => 2 as const),
      declineDiagnostic: vi.fn(async () => undefined),
      ...overrides,
    });
  }

  async function answerAll(page: PracticePage, count: number) {
    for (let i = 0; i < count; i++) {
      page.onAnswerInput(String(i + 1));
      await page.submit();
    }
  }

  it('en una habilidad sin intentos ofrece la prueba y no pide ejercicio de práctica', async () => {
    const { page, port, fixture } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    fixture.detectChanges();
    expect(page.diag).toBe('offer');
    expect(port.newExercise).not.toHaveBeenCalled();
    expect(query(fixture, '[data-testid="diag-offer"]')?.textContent).toContain(
      'No importa si te equivocas',
    );
  });

  it('no se ofrece en una habilidad ya practicada', async () => {
    const { page, port } = diagSetup();
    await page.ngOnInit();
    await page.choose({ ...NEW_SKILL, diagnosticAvailable: false });
    expect(page.diag).toBeNull();
    expect(port.newExercise).toHaveBeenCalled();
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('"No, empezar a practicar" pide confirmar; confirmado se guarda y sigue la práctica', async () => {
    const { page, port } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    page.declineWaitMs = 5;
    page.askDecline();
    expect(page.declineStep).toBe('confirm');
    expect(page.declineReady).toBe(false);
    await page.confirmDecline(); // todavía no: el botón espera
    expect(port.declineDiagnostic).not.toHaveBeenCalled();
    await wait(10);
    expect(page.declineReady).toBe(true);
    await page.confirmDecline();
    expect(port.declineDiagnostic).toHaveBeenCalledWith('perfil-1', NEW_SKILL.id);
    expect(page.diag).toBeNull();
    expect(port.newExercise).toHaveBeenCalledWith('perfil-1', NEW_SKILL.id);
    expect(port.diagnosticExercise).not.toHaveBeenCalled();
  });

  it('la confirmación dice que no se podrá hacer después; botón desactivado 3 s y anuncio sin cuenta atrás', async () => {
    const { page, fixture } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    expect(page.declineWaitMs).toBe(3000);
    page.declineWaitMs = 5;
    page.askDecline();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    expect(q('diag-decline-detail').textContent).toContain('no podrás hacer esta prueba después');
    expect(q('diag-decline-wait').textContent).toContain('Léelo con calma');
    expect(page.message).toBe(''); // Numi no sigue invitando a la prueba
    const confirm = () => (q('diag-decline-confirm') as unknown as { disabled: boolean }).disabled;
    expect(confirm()).toBe(true);
    expect(q('diag-decline-status').getAttribute('aria-live')).toBe('polite');
    expect(q('diag-decline-status').textContent?.trim()).toBe('');
    await wait(10);
    fixture.detectChanges();
    expect(confirm()).toBe(false);
    expect(q('diag-decline-status').textContent?.trim()).toBe('Ya puedes elegir.');
    expect(q('diag-decline-wait')).toBeNull();
    expect(el.querySelector('[data-testid="diag-offer"]')!.textContent).not.toMatch(/\d/); // sin cuenta atrás
  });

  it('mientras se guarda el rechazo no se puede volver; guardado, el tema ya no ofrece el test', async () => {
    let finish!: () => void;
    const declineDiagnostic = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { page, fixture } = diagSetup({ declineDiagnostic });
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    page.askDecline();
    page.declineReady = true; // sin depender del temporizador (la espera se prueba aparte)
    const saving = page.confirmDecline();
    fixture.detectChanges();
    const back = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="diag-decline-back"]') as unknown as { disabled: boolean };
    expect(back.disabled).toBe(true);
    await page.confirmDecline(); // un segundo toque no envía otra vez
    expect(declineDiagnostic).toHaveBeenCalledTimes(1);
    finish();
    await saving;
    expect(page.diag).toBeNull();
    expect(page.topics.find((t) => t.id === NEW_SKILL.id)?.diagnosticAvailable).toBe(false);
  });

  it('si el niño cambió de tema mientras se guardaba, no se le cambia la pantalla', async () => {
    let finish!: () => void;
    const declineDiagnostic = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { page } = diagSetup({ declineDiagnostic });
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    page.askDecline();
    page.declineReady = true; // sin depender del temporizador (la espera se prueba aparte)
    const saving = page.confirmDecline();
    page.topic = { ...NEW_SKILL, id: 'otro' };
    finish();
    await saving;
    expect(page.topic.id).toBe('otro');
  });

  it('"Volver" regresa a la oferta sin rechazar', async () => {
    const { page, port } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    page.askDecline();
    page.cancelDecline();
    expect(page.declineStep).toBeNull();
    expect(page.diag).toBe('offer');
    expect(port.declineDiagnostic).not.toHaveBeenCalled();
  });

  it('si el rechazo no se guarda: mensaje sin culpa, reintentar o practicar igual (sin darlo por hecho)', async () => {
    const declineDiagnostic = vi.fn(async () => {
      throw new Error('red');
    });
    const { page, port } = diagSetup({ declineDiagnostic });
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    page.declineWaitMs = 0;
    page.askDecline();
    await wait(5);
    await page.confirmDecline();
    expect(page.declineStep).toBe('error');
    expect(page.declineStatus).toBe(''); // el error lo lee el foco en su título, sin repetirlo
    expect(page.diag).toBe('offer');
    await page.confirmDecline(); // reintentar
    expect(declineDiagnostic).toHaveBeenCalledTimes(2);
    await page.startPracticeAnyway();
    expect(page.diag).toBeNull();
    expect(port.newExercise).toHaveBeenCalledWith('perfil-1', NEW_SKILL.id);
  });

  it('hace 6 ejercicios en orden, sin decir si estaban bien, y envía todo al final', async () => {
    const { page, port, fixture } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    await page.startDiagnostic();
    fixture.detectChanges();
    expect(query(fixture, '[data-testid="diag-progress"]')?.textContent).toContain('1 de 6');

    await answerAll(page, 5);
    expect(page.result).toBeNull();
    expect(port.answer).not.toHaveBeenCalled();
    expect(port.submitDiagnostic).not.toHaveBeenCalled();

    page.onAnswerInput('9');
    await page.submit();
    const steps = (port.diagnosticExercise as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5]);
    expect(port.submitDiagnostic).toHaveBeenCalledWith(
      'perfil-1',
      NEW_SKILL.id,
      [1, 2, 3, 4, 5, 9].map((answer, i) => ({ token: `d${i}`, answer })),
    );
    fixture.detectChanges();
    expect(page.diag).toBe('done');
    expect(query(fixture, '[data-testid="diag-title"]')?.textContent).toContain('nivel 2');
    // Sin medallas ni marcador: el diagnóstico no es práctica.
    expect(page.total).toBe(0);
    expect(page.streak).toBe(0);
  });

  it('"Empezar a practicar" sigue con la práctica en el nivel guardado', async () => {
    const { page, port } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    await page.startDiagnostic();
    await answerAll(page, 6);
    await page.startAfterDiagnostic();
    expect(page.diag).toBeNull();
    expect(port.newExercise).toHaveBeenCalledWith('perfil-1', NEW_SKILL.id);
  });

  it('abandonar a la mitad no envía nada', async () => {
    const { page, port } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    await page.startDiagnostic();
    await answerAll(page, 3);
    page.changeTopic();
    expect(page.diag).toBeNull();
    expect(port.submitDiagnostic).not.toHaveBeenCalled();
  });

  it('salir de la pantalla a la mitad también lo abandona', async () => {
    const { page, port } = diagSetup();
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    await page.startDiagnostic();
    await answerAll(page, 2);
    page.ionViewWillLeave();
    expect(page.diag).toBeNull();
    expect(page.topic).toBeNull();
    expect(port.submitDiagnostic).not.toHaveBeenCalled();
  });

  it('si la prueba no se puede guardar, avisa sin culpa y parte en nivel 1', async () => {
    const { page, fixture } = diagSetup({
      submitDiagnostic: vi.fn(async () => {
        throw new PracticeError('expired');
      }),
    });
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    await page.startDiagnostic();
    await answerAll(page, 6);
    fixture.detectChanges();
    expect(page.diag).toBe('done');
    expect(page.diagLevel).toBe(1);
    expect(query(fixture, '[data-testid="diag-title"]')?.textContent).toContain('nivel 1');
    expect(TestBed.inject(MascotPort).state()).not.toBe('sad');
  });

  it('si ya no está disponible (409), sigue directo con la práctica', async () => {
    const { page, port } = diagSetup({
      submitDiagnostic: vi.fn(async () => {
        throw new PracticeError('already_answered');
      }),
    });
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    await page.startDiagnostic();
    await answerAll(page, 6);
    await Promise.resolve();
    expect(page.diag).toBeNull();
    expect(port.newExercise).toHaveBeenCalledWith('perfil-1', NEW_SKILL.id);
  });

  it('si falla un ejercicio a la mitad, no envía nada y parte en nivel 1', async () => {
    const { page, port } = diagSetup({
      diagnosticExercise: vi.fn(async (_s: string, _t: string, step: number) => {
        if (step === 2) throw new PracticeError('network');
        return diagExercise(step);
      }),
    });
    await page.ngOnInit();
    await page.choose(NEW_SKILL);
    await page.startDiagnostic();
    await answerAll(page, 2);
    expect(page.diag).toBe('done');
    expect(page.diagLevel).toBe(1);
    expect(port.submitDiagnostic).not.toHaveBeenCalled();
  });
});

describe('PracticePage: sin conexión (CU-A12)', () => {
  const NOW_S = Math.floor(Date.now() / 1000);

  async function batch(n: number): Promise<OfflineBatch> {
    const exercises = [];
    for (let k = 0; k < n; k++) {
      exercises.push({
        token: `off-${k}`,
        topic: '2-06',
        level: 1 as const,
        text: `${k} + 2 = ?`,
        answerKind: 'integer' as const,
        solutionHash: await solutionHash('sal', String(k + 2)),
        used: false,
      });
    }
    return {
      studentId: 'perfil-1',
      salt: 'sal',
      issuedAt: NOW_S,
      expiresAt: NOW_S + 7 * 24 * 3600,
      topics: [
        {
          id: '2-06', label: 'Sumas hasta 100', module: 'Números y operaciones', grade: 2,
          level: 1, blockDone: 0, blockCorrect: 0, blockSize: 10, mastered: false,
        },
      ],
      exercises,
    };
  }

  afterEach(() => vi.restoreAllMocks());

  /**
   * Simula el dispositivo sin red y con un lote de `n` ejercicios guardado. Todo se prepara ANTES
   * de crear la pantalla: el fixture llama a ngOnInit apenas se crea.
   */
  async function offlineSetup(n = 3) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const store = new MemoryOfflineStore();
    if (n > 0) await store.saveBatch(await batch(n));
    TestBed.overrideProvider(OfflineStore, { useValue: store });
    const ctx = setup();
    await ctx.page.ngOnInit();
    await ctx.fixture.whenStable();
    ctx.fixture.detectChanges();
    return { ...ctx, store };
  }

  it('avisa que no hay internet y muestra solo las habilidades del lote, sin tareas ni racha', async () => {
    const { page, port, fixture, assignments, progress } = await offlineSetup();
    expect(page.offlineMode).toBe(true);
    expect(port.topics).not.toHaveBeenCalled();
    expect(assignments.forKid).not.toHaveBeenCalled();
    expect(progress.get).not.toHaveBeenCalled();
    expect(query(fixture, '[data-testid="offline-banner"]')?.textContent).toContain(
      OFFLINE_MESSAGES.banner,
    );
    expect(page.topics.map((t) => t.id)).toEqual(['2-06']);
  });

  it('la tarjeta de tareas sigue visible, pero sin red avisa "Esto necesita internet"', async () => {
    const { fixture } = await offlineSetup();
    const card = query(fixture, '[data-testid="tasks-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    card.click();
    fixture.detectChanges();
    expect(TestBed.inject(NavController).navigateForward).not.toHaveBeenCalled();
    expect(query(fixture, '[data-testid="offline-notice"]')?.textContent).toContain(
      OFFLINE_MESSAGES.needsInternet,
    );
  });

  it('practica con el lote: corrige en el dispositivo y guarda el intento en la cola', async () => {
    const { page, port, store, fixture } = await offlineSetup();
    await page.choose(page.topics[0]);
    expect(port.newExercise).not.toHaveBeenCalled();
    expect(page.exercise?.text).toBe('0 + 2 = ?');
    page.onAnswerInput('2');
    await page.submit();
    expect(page.result?.correct).toBe(true);
    expect(port.answer).not.toHaveBeenCalled();
    expect(await store.queue('perfil-1')).toHaveLength(1);
    // Sin explicación de Numi sin conexión (no hay IA sin el servidor).
    await page.next();
    page.onAnswerInput('9');
    await page.submit();
    fixture.detectChanges();
    expect(page.result?.correct).toBe(false);
    expect(page.canExplain).toBe(false);
    expect(query(fixture, '[data-testid="result-text"]')?.textContent?.trim()).toBe('Casi.');
  });

  it('no muestra el resultado hasta que el intento quedó guardado (RNF-06)', async () => {
    const { page, store } = await offlineSetup();
    let release!: () => void;
    const original = store.recordAttempt.bind(store);
    store.recordAttempt = (b, a) =>
      new Promise<void>((resolve) => {
        release = () => void original(b, a).then(resolve);
      });
    await page.choose(page.topics[0]);
    page.onAnswerInput('2');
    const pending = page.submit();
    // Espera a que empiece el guardado (el hash con crypto.subtle es asíncrono).
    for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 0));
    expect(page.result).toBeNull();
    release();
    await pending;
    expect(page.result?.correct).toBe(true);
    expect(store.attempts).toHaveLength(1);
  });

  it('si no se pudo guardar, no confirma nada y pide intentar otra vez', async () => {
    const { page, store } = await offlineSetup();
    await page.choose(page.topics[0]);
    store.failWrites = new Error('quota');
    page.onAnswerInput('2');
    await page.submit();
    expect(page.result).toBeNull();
    expect(page.error).toBe(OFFLINE_MESSAGES.storage);
    expect(TestBed.inject(MascotService).state()).not.toBe('sad');
  });

  it('lote agotado: avisa y sugiere elegir otro tema', async () => {
    const { page, fixture } = await offlineSetup(1);
    await page.choose(page.topics[0]);
    page.onAnswerInput('2');
    await page.submit();
    await page.next();
    fixture.detectChanges();
    expect(page.exercise).toBeNull();
    expect(page.offlineNotice).toBe(OFFLINE_MESSAGES.exhausted);
    // Dice qué hacer mientras tanto, sin culpa.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Puedes elegir otro tema');
    // Al volver a la lista, la baldosa lo dice.
    page.changeTopic();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(query(fixture, '[data-testid="tile-exhausted"]')).not.toBeNull();
  });

  it('sin lote descargado: pide conectarse una vez', async () => {
    const { page } = await offlineSetup(0);
    expect(page.topics).toEqual([]);
    expect(page.offlineNotice).toBe(OFFLINE_MESSAGES.noBatch);
  });

  it('con conexión deja listo el lote para después', async () => {
    const download = vi.fn(async () => batch(2));
    TestBed.overrideProvider(OfflineBatchPort, { useValue: { download } });
    const ctx = setup();
    await ctx.page.ngOnInit();
    await new Promise((r) => setTimeout(r, 0));
    expect(download).toHaveBeenCalledWith('perfil-1');
    expect(ctx.page.offlineMode).toBe(false);
  });
});

describe('PracticePage: botón "Jugar" (CU-A21)', () => {
  async function withTopics(topics: unknown[]) {
    const ctx = setup({ topics: vi.fn(async () => topics) } as never);
    await ctx.page.ngOnInit();
    await new Promise((r) => setTimeout(r, 0)); // la lista de juegos llega aparte
    ctx.fixture.detectChanges();
    return ctx;
  }

  // Un juego de un tema que no se practica (fase B) y uno del tema que sí.
  const FIGURES = { id: 'toca-figura-1', name: 'Toca la figura', kind: 'choice' as const, skill: '1-17' };
  const SAME = { id: 'cuantos-1', name: '¿Cuántos hay?', kind: 'choice' as const, skill: TOPIC.id };
  beforeEach(() => {
    gameGroups = [{ module: 'Geometría', games: [FIGURES] }, { module: 'Números', games: [SAME] }];
  });

  it('"Más juegos" en 1°: abre la selección con solo los juegos de temas que no se practican', async () => {
    const { fixture, nav } = await withTopics([{ ...TOPIC, grade: 1, review: false }]);
    const card = query(fixture, '[data-testid="games-card"]') as HTMLElement;
    expect(card?.textContent).toContain('Más juegos');
    card.click();
    expect(nav.navigateForward).toHaveBeenCalledWith(['/juegos', 'perfil-1'], {
      queryParams: { juegos: 'toca-figura-1' },
    });
  });

  it('no aparece si todos los juegos son de temas que se practican', async () => {
    gameGroups = [{ module: 'Números', games: [SAME] }];
    const { fixture } = await withTopics([{ ...TOPIC, grade: 1, review: false }]);
    expect(query(fixture, '[data-testid="games-card"]')).toBeNull();
  });

  it('aparece en 2° (el repaso de 1° no cambia el curso)', async () => {
    const { fixture } = await withTopics([
      { ...TOPIC, grade: 2, review: false },
      { ...TOPIC, id: 'r', grade: 1, review: true },
    ]);
    expect(query(fixture, '[data-testid="games-card"]')).not.toBeNull();
  });

  it('no aparece en 3° ni 4°', async () => {
    const { fixture } = await withTopics([{ ...TOPIC, grade: 3, review: false }]);
    expect(query(fixture, '[data-testid="games-card"]')).toBeNull();
  });

  it('si no se puede deducir el curso, no aparece', async () => {
    const { fixture } = await withTopics([{ ...TOPIC }]);
    expect(query(fixture, '[data-testid="games-card"]')).toBeNull();
  });

  describe('"Aprender jugando" dentro de cada tema', () => {
    const game = (id: string, skill: string) => ({ id, name: id, kind: 'choice' as const, skill });
    const CATALOG = [
      {
        module: 'Números y operaciones',
        games: [game('mayor-1', '1-03'), game('ordena-1', '1-03'), game('cuantos-1', '1-02')],
      },
      { module: 'Patrones y álgebra', games: [game('que-sigue-1', '1-13')] },
    ];
    async function inTopic(id: string, grade: number) {
      gameGroups = CATALOG;
      const topic = { ...TOPIC, id, grade, review: false };
      const ctx = await withTopics([topic]);
      await ctx.page.choose(topic as never);
      await new Promise((r) => setTimeout(r, 0));
      ctx.fixture.detectChanges();
      return { ...ctx, button: query(ctx.fixture, '[data-testid="learn-playing"]') as HTMLElement | null };
    }

    it('un juego en el tema: abre directo su introducción', async () => {
      const { button, nav } = await inTopic('1-13', 1);
      expect(button?.textContent).toContain('Aprender jugando');
      button!.click();
      expect(nav.navigateForward).toHaveBeenCalledWith(['/juegos', 'perfil-1'], {
        queryParams: { juego: 'que-sigue-1' },
      });
    });

    it('varios juegos en el tema: abre la lista filtrada por el tema', async () => {
      const { button, nav } = await inTopic('1-03', 1);
      button!.click();
      expect(nav.navigateForward).toHaveBeenCalledWith(['/juegos', 'perfil-1'], {
        queryParams: { tema: '1-03' },
      });
    });

    it('no aparece durante la prueba corta (tocarlo la abandonaría)', async () => {
      const { page, fixture } = await inTopic('1-13', 1);
      page.diag = 'running';
      fixture.detectChanges();
      expect(page.topicGames).toEqual([]);
    });

    it('un tema sin juego no lo muestra', async () => {
      const { button } = await inTopic('1-06', 1);
      expect(button).toBeNull();
    });

    it('en 3° no se muestra ni se pide la lista de juegos', async () => {
      const { button, games } = await inTopic('1-13', 3);
      expect(button).toBeNull();
      expect(games.list).not.toHaveBeenCalled();
    });

    it('si la lista de juegos falla, no se muestra (la práctica sigue)', async () => {
      gameGroups = CATALOG;
      gamesFail = true;
      const topic = { ...TOPIC, id: '1-13', grade: 1, review: false };
      const ctx = await withTopics([topic]);
      expect(query(ctx.fixture, '[data-testid="games-card"]')).toBeNull(); // ni "Más juegos"
      await ctx.page.choose(topic as never);
      await new Promise((r) => setTimeout(r, 0));
      ctx.fixture.detectChanges();
      expect(query(ctx.fixture, '[data-testid="learn-playing"]')).toBeNull();
      expect(ctx.page.exercise).not.toBeNull();
    });
  });

  it('sin conexión no aparece (los juegos necesitan internet)', async () => {
    const { fixture, page } = await withTopics([{ ...TOPIC, grade: 1, review: false }]);
    expect(query(fixture, '[data-testid="games-card"]')).not.toBeNull();
    page.offlineMode = true;
    expect(page.canPlay).toBe(false);
  });
});
