import { ChangeDetectorRef, Component, Injector, OnInit, afterNextRender, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import {
  BAG_GAMES,
  DEFAULT_INSTRUCTION,
  GAME_INSTRUCTIONS,
  GAME_TEXT,
  emojiName,
  splitEmojiRun,
  spokenEquation,
} from '../core/games/games.messages';
import {
  GameError,
  GameExercise,
  GameGroup,
  GameInfo,
  GameResult,
  GamesPort,
} from '../core/games/games.port';
import { MascotPort } from '../core/mascot/mascot.port';
import { MEDAL_EVERY } from '../core/practice/medals';

/** Rondas por juego (decisión del dueño). */
export const ROUNDS = 5;

export type GameStep = 'loading' | 'axes' | 'games' | 'intro' | 'round' | 'summary' | 'blocked';

/**
 * Juegos de refuerzo (CU-A21, parte 2) para 1° y 2° básico.
 *
 * Flujo: elegir eje → elegir juego → instrucción corta de Numi (sin voz) → 5 rondas → resumen con
 * "Jugar de nuevo", "Otro juego" o "Volver a practicar".
 *
 * - Corrige el servidor; la solución llega solo DESPUÉS de responder.
 * - Cada respuesta queda registrada en el momento: si el niño sale a medias, lo respondido ya está.
 * - Sin nivel ni progreso. Suma a la racha (en el servidor) y a las medallas (aquí, como la
 *   práctica: 5 aciertos seguidos).
 * - Sin internet NO funciona (no usa el modo sin conexión): aviso para pedir ayuda a un adulto y
 *   botón para reintentar.
 * - Sin cronómetro ni cuenta regresiva.
 */
@Component({
  selector: 'app-games',
  templateUrl: 'games.page.html',
  styleUrls: ['games.page.scss'],
  standalone: false,
})
export class GamesPage implements OnInit {
  private readonly port = inject(GamesPort);
  private readonly route = inject(ActivatedRoute);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  /** Token del ejercicio cuya bolsa está llena (las opciones se habilitan). */
  private bagFullToken: string | null = null;
  protected readonly mascot = inject(MascotPort);
  protected readonly text = GAME_TEXT;
  protected readonly rounds = ROUNDS;

  studentId = '';
  step: GameStep = 'loading';
  groups: GameGroup[] = [];
  axis: GameGroup | null = null;
  game: GameInfo | null = null;
  exercise: GameExercise | null = null;
  result: GameResult | null = null;
  chosen: string | null = null;
  busy = false;
  round = 0;
  correctCount = 0;
  streak = 0;
  medals = 0;
  medalNow = false;
  /** Aviso amable (sin red, error) y qué hacer al tocar "Intentar otra vez". */
  notice = '';
  private retryAction: (() => Promise<void>) | null = null;

  async ngOnInit(): Promise<void> {
    this.studentId = this.route.snapshot.paramMap.get('id') ?? '';
    this.mascot.set('idle');
    await this.loadList();
  }

  /** Lo que Numi dice ahora (instrucción del juego). */
  get instruction(): string {
    return (this.game && GAME_INSTRUCTIONS[this.game.id]) ?? DEFAULT_INSTRUCTION;
  }

  /** "5 = 3 + ?" dicho en voz alta: "5 es igual a 3 más ¿cuántas manzanas?" (o null). */
  get spokenBefore(): string | null {
    const { before, glyphs } = this.prompt;
    return spokenEquation(before, glyphs);
  }

  /** Enunciado separado: los emoji repetidos se resumen para el lector de pantalla. */
  get prompt(): { before: string; glyphs: string; spoken: string } {
    return splitEmojiRun(this.exercise?.text ?? '');
  }

  get canRetry(): boolean {
    return this.retryAction !== null;
  }

  async retry(): Promise<void> {
    const action = this.retryAction;
    this.notice = '';
    this.retryAction = null;
    if (action) await action();
  }

  private async loadList(): Promise<void> {
    this.step = 'loading';
    try {
      this.groups = await this.port.list(this.studentId);
      this.step = 'axes';
      this.notice = '';
      this.openFromTopic();
    } catch (error) {
      this.fail(error, () => this.loadList());
    }
    this.cdr.markForCheck();
  }

  /**
   * "Aprender jugando" desde la práctica de un tema: `?juego=` abre directo su introducción y
   * `?tema=` la lista con solo los juegos de esa habilidad (sin pasar por la elección de eje).
   */
  private openFromTopic(): void {
    const params = this.route.snapshot.queryParamMap;
    const gameId = params?.get('juego');
    const skill = params?.get('tema');
    const game = gameId ? this.groups.flatMap((g) => g.games).find((g) => g.id === gameId) : null;
    if (game) {
      this.chooseGame(game);
      return;
    }
    if (!skill) return;
    for (const group of this.groups) {
      const games = group.games.filter((g) => g.skill === skill);
      if (games.length) {
        this.chooseAxis({ module: group.module, games });
        return;
      }
    }
  }

  chooseAxis(group: GameGroup): void {
    this.axis = group;
    this.step = 'games';
  }

  chooseGame(game: GameInfo): void {
    this.game = game;
    this.step = 'intro';
    this.mascot.set('talking');
  }

  /** Juegos del mismo tema (habilidad) que el juego actual. */
  get sameTopicGames(): GameInfo[] {
    const skill = this.game?.skill;
    return skill ? this.groups.flatMap((g) => g.games).filter((g) => g.skill === skill) : [];
  }

  /** "Otro juego de este tema": la lista con solo los juegos de esa habilidad (nunca los ejes). */
  otherOfTopic(): void {
    const games = this.sameTopicGames;
    const group = this.groups.find((g) => g.games.some((x) => x.id === this.game?.id));
    this.game = null;
    this.exercise = null;
    this.result = null;
    this.mascot.set('idle');
    this.chooseAxis({ module: group?.module ?? '', games });
  }

  backToPractice(): Promise<boolean> {
    return this.nav.navigateBack(['/practica', this.studentId]);
  }

  async start(): Promise<void> {
    this.round = 0;
    this.correctCount = 0;
    this.streak = 0;
    this.medalNow = false;
    await this.nextRound();
  }

  async nextRound(): Promise<void> {
    this.medalNow = false;
    if (this.round >= ROUNDS) {
      this.step = 'summary';
      this.exercise = null;
      this.notice = '';
      this.retryAction = null;
      this.mascot.set('happy');
      this.cdr.markForCheck();
      // El foco va al título del resumen (el botón que se tocó ya no existe).
      this.focusSoon('game-summary');
      return;
    }
    this.round += 1;
    await this.loadExercise();
  }

  private async loadExercise(): Promise<void> {
    if (!this.game) return;
    this.busy = true;
    this.result = null;
    this.chosen = null;
    this.step = 'round';
    this.mascot.set('thinking');
    try {
      this.exercise = await this.port.exercise(this.studentId, this.game.id);
      this.notice = '';
    } catch (error) {
      this.exercise = null;
      this.fail(error, () => this.loadExercise());
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  /** Opciones: un toque responde. */
  async pick(id: string): Promise<void> {
    if (this.busy || this.result) return;
    this.chosen = id;
    await this.submit([id]);
  }

  /** Orden: "Listo" con todas las tarjetas puestas. */
  async onOrderReady(answer: string[]): Promise<void> {
    if (this.busy || this.result) return;
    await this.submit(answer);
  }

  private async submit(answer: string[]): Promise<void> {
    if (!this.exercise) return;
    this.busy = true;
    try {
      this.result = await this.port.answer(this.studentId, this.exercise.token, answer);
      this.notice = '';
      if (this.result.correct) {
        this.correctCount += 1;
        this.streak += 1;
        if (this.streak % MEDAL_EVERY === 0) {
          this.medals += 1;
          this.medalNow = true;
        }
        this.mascot.set('happy');
      } else {
        this.streak = 0;
        // Sin tristeza: Numi piensa contigo (como en la práctica).
        this.mascot.set('thinking');
      }
      // Tras responder, las opciones quedan desactivadas: el foco pasa a "Siguiente" y se muestra en
      // pantalla (a 360 px podía quedar más abajo).
      this.focusSoon('game-next', true);
    } catch (error) {
      if (error instanceof GameError && error.code === 'already_answered') {
        // Ya estaba registrado (p. ej. se reintentó tras perder la red): se sigue con otro.
        this.notice = GAME_TEXT.already;
        this.retryAction = null;
        await this.nextRound();
        return;
      }
      if (error instanceof GameError && error.code === 'expired') {
        // Venció: se pide otro ejercicio en la misma ronda, sin culpa.
        await this.loadExercise();
        return;
      }
      this.fail(error, () => this.submit(answer));
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  /** "Mete en la bolsa" (pon-en-bolsa-1): los emoji del enunciado se dibujan como objetos sueltos. */
  get bag(): { glyph: string; name: string; feminine: boolean; count: number } | null {
    if (!this.exercise || !BAG_GAMES.has(this.exercise.gameId)) return null;
    const glyphs = this.prompt.glyphs.replace(/\s+/g, '');
    const first = glyphs ? Array.from(glyphs)[0] : '';
    const names = first ? emojiName(first) : null;
    if (!names) return null;
    return { glyph: first, name: names.singular, feminine: names.feminine, count: glyphs.split(first).length - 1 };
  }

  /** Con la bolsa, las opciones se habilitan solo con todos los objetos dentro (contar uno a uno). */
  get bagReady(): boolean {
    return !this.bag || this.bagFullToken === this.exercise?.token;
  }

  onBagAllIn(full: boolean): void {
    this.bagFullToken = full ? (this.exercise?.token ?? null) : null;
    this.cdr.markForCheck();
    // Con todos dentro, el foco pasa a la primera opción (ya habilitada).
    if (full) {
      afterNextRender(() => document.querySelector<HTMLElement>('[data-testid^="option-"]')?.focus(), {
        injector: this.injector,
      });
    }
  }

  /** Lleva el foco (y si hace falta, la vista) a un elemento recién dibujado. */
  private focusSoon(id: string, scroll = false): void {
    // Después del próximo dibujo: antes, el botón todavía no existe.
    afterNextRender(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.focus({ preventScroll: true });
      if (scroll) {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      }
    }, { injector: this.injector });
  }

  private fail(error: unknown, retry: () => Promise<void>): void {
    const code = error instanceof GameError ? error.code : 'unavailable';
    if (code === 'grade') {
      this.step = 'blocked';
      this.notice = GAME_TEXT.grade;
      this.retryAction = null;
      return;
    }
    this.notice = code === 'network' ? GAME_TEXT.offline : GAME_TEXT.error;
    this.retryAction = retry;
    this.mascot.set('idle');
  }
}
