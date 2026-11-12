import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { ChoiceOptionsComponent } from '../core/games/choice-options.component';
import { GameVisualComponent } from '../core/games/game-visual.component';
import { DEFAULT_INSTRUCTION, GAME_INSTRUCTIONS, GAME_TEXT } from '../core/games/games.messages';
import { GameError, GameExercise, GamesPort } from '../core/games/games.port';
import { OrderCardsComponent } from '../core/games/order-cards.component';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { GamesPage, ROUNDS } from './games.page';

const GROUPS = [
  {
    module: 'Números y operaciones',
    games: [
      { id: 'mayor-1', name: '¿Cuál es mayor?', kind: 'choice' as const },
      { id: 'ordena-1', name: 'Ordena los números', kind: 'order' as const },
    ],
  },
];

const CHOICE: GameExercise = {
  token: 'tok-c',
  gameId: 'mayor-1',
  kind: 'choice',
  text: '¿Cuál es el número mayor?',
  options: [
    { id: 'n:3', kind: 'number', label: '3' },
    { id: 'n:9', kind: 'number', label: '9' },
  ],
};
const ORDER: GameExercise = {
  token: 'tok-o',
  gameId: 'ordena-1',
  kind: 'order',
  text: 'Ordena de menor a mayor.',
  options: [
    { id: 'n:5', kind: 'number', label: '5' },
    { id: 'n:2', kind: 'number', label: '2' },
  ],
};

function setup(over: Partial<Record<keyof GamesPort, unknown>> = {}) {
  const port = {
    list: vi.fn(async () => GROUPS),
    exercise: vi.fn(async (_s: string, id: string) => (id === 'ordena-1' ? ORDER : CHOICE)),
    answer: vi.fn(async (_s: string, _t: string, a: string[]) => ({
      correct: a[0] === 'n:9' || a.join() === 'n:2,n:5',
      correctAnswer: a.length === 1 ? ['n:9'] : ['n:2', 'n:5'],
      message: a[0] === 'n:9' || a.join() === 'n:2,n:5' ? '¡Muy bien!' : 'Casi. Esta era la respuesta.',
    })),
    ...over,
  };
  const nav = { navigateBack: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    declarations: [GamesPage, MascotComponent],
    imports: [IonicModule.forRoot(), ChoiceOptionsComponent, OrderCardsComponent, GameVisualComponent],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: GamesPort, useValue: port },
      { provide: NavController, useValue: nav },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'p1' } } } },
    ],
  });
  const fixture = TestBed.createComponent(GamesPage);
  const page = fixture.componentInstance;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const render = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, page, port, nav, el, q, render };
}

describe('GamesPage (CU-A21)', () => {
  it('muestra los ejes y, al elegir uno, sus juegos', async () => {
    const { page, q, render } = setup();
    await render(); // la creación ya llamó a ngOnInit
    expect(page.step).toBe('axes');
    q('axis-0')!.click();
    await render();
    expect(q('game-mayor-1')?.textContent).toContain('¿Cuál es mayor?');
    expect(q('game-ordena-1')).not.toBeNull();
  });

  it('Numi da la instrucción corta antes de empezar (sin voz)', async () => {
    const { page, el, render } = setup();
    await render(); // la creación ya llamó a ngOnInit
    page.chooseAxis(GROUPS[0]);
    page.chooseGame(GROUPS[0].games[0]);
    await render();
    expect(page.step).toBe('intro');
    expect(el().textContent).toContain('Toca el número más grande.');
  });

  it('juega una ronda de opciones de punta a punta: un toque responde y muestra el resultado sin culpa', async () => {
    const { page, port, q, render } = setup();
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await render();
    expect(q('game-round')?.textContent).toContain(`Ronda 1 de ${ROUNDS}`);
    q('option-n:3')!.click();
    await render();
    expect(port.answer).toHaveBeenCalledWith('p1', 'tok-c', ['n:3']);
    expect(q('game-result')?.textContent).toContain('Casi.');
    // Lo correcto aparece solo después de responder.
    expect(q('option-n:9')?.textContent).toContain(GAME_TEXT.correctBadge);
  });

  it('juega una ronda de orden de punta a punta con "Listo"', async () => {
    const { page, port, q, render } = setup();
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[1]);
    await page.start();
    await render();
    q('pool-n:2')!.click();
    await render();
    q('pool-n:5')!.click();
    await render();
    q('order-ready')!.click();
    await render();
    expect(port.answer).toHaveBeenCalledWith('p1', 'tok-o', ['n:2', 'n:5']);
    expect(q('game-result')?.textContent).toContain('¡Muy bien!');
  });

  it('completar el camino: las tarjetas fijas no se mueven y "Listo" manda la secuencia completa', async () => {
    const FILL: GameExercise = {
      token: 'tok-f',
      gameId: 'completa-camino-1',
      kind: 'fill',
      text: 'Completa el camino: de 2 en 2.',
      options: [
        { id: 'n:2', kind: 'number', label: '2' },
        { id: 'n:4', kind: 'number', label: '4' },
        { id: 'n:6', kind: 'number', label: '6' },
        { id: 'n:7', kind: 'number', label: '7' },
      ],
      slots: ['n:2', 'n:4', null],
    };
    const answer = vi.fn(async () => ({ correct: true, correctAnswer: ['n:2', 'n:4', 'n:6'], message: '¡Muy bien!' }));
    const { page, q, render } = setup({ exercise: vi.fn(async () => FILL), answer });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame({ id: 'completa-camino-1', name: 'Completa el camino', kind: 'fill' });
    await page.start();
    await render();
    expect((q('slot-card-0') as HTMLButtonElement).disabled).toBe(true); // fija
    expect(q('pool-n:2')).toBeNull(); // las fijas no están en el montón
    q('pool-n:6')!.click();
    await render();
    q('order-ready')!.click();
    await render();
    expect(answer).toHaveBeenCalledWith('p1', 'tok-f', ['n:2', 'n:4', 'n:6']);
    expect(q('game-result')?.textContent).toContain('¡Muy bien!');
  });

  it('recorre el catálogo de 1° (10 temas en 5 ejes): cada juego abre, se juega y corrige', async () => {
    const n = (v: number) => ({ id: `n:${v}`, kind: 'number', label: String(v) });
    const fig = (id: string, label: string) => ({ id: `f:${id}`, kind: 'figure', label });
    const emoji = (o: string, g: string) => ({ id: `e:${o}-1`, kind: 'emoji', label: g });
    // Un ejercicio de muestra por juego, con la forma que manda el servidor.
    const SAMPLE: Record<string, Partial<GameExercise>> = {
      'completa-camino-1': { kind: 'fill', options: [n(2), n(4), n(9)], slots: ['n:2', null] },
      'ordena-1': { kind: 'order', options: [n(5), n(2)] },
      'figura-sigue-1': {
        options: [fig('circulo-rojo', 'círculo rojo'), fig('cuadrado-azul', 'cuadrado azul')],
        pattern: [fig('circulo-rojo', 'círculo rojo'), fig('cuadrado-azul', 'cuadrado azul')],
      },
      'toca-figura-1': { options: [fig('cubo-rojo', 'cubo rojo'), fig('esfera-azul', 'esfera azul')] },
      'donde-esta-1': {
        options: [emoji('pelota', '⚽'), emoji('flor', '🌸')],
        scene: {
          center: '📦',
          centerName: 'caja',
          places: [
            { position: 'arriba', id: 'e:pelota-1' },
            { position: 'abajo', id: 'e:flor-1' },
          ],
        },
      },
      'mide-clips-1': {
        options: [n(3), n(4)],
        measure: { thing: 'cinta', name: 'la cinta', unit: 'clip', glyph: '📎', length: 3 },
      },
      'pictograma-1': {
        options: [n(3), n(5)],
        picto: [
          { glyph: '🍎', name: 'manzanas', count: 3 },
          { glyph: '⚽', name: 'pelotas', count: 5 },
        ],
      },
    };
    const CATALOG = [
      { module: 'Números y operaciones', ids: ['mayor-1', 'cuantos-1', 'donde-hay-mas-1', 'ordena-1', 'completa-camino-1', 'descompone-1', 'junta-1'] },
      { module: 'Patrones y álgebra', ids: ['que-sigue-1', 'figura-sigue-1'] },
      { module: 'Geometría', ids: ['toca-figura-1', 'donde-esta-1'] },
      { module: 'Medición', ids: ['mide-clips-1'] },
      { module: 'Datos y probabilidades', ids: ['pictograma-1'] },
    ];
    const kindOf = (id: string) => (SAMPLE[id]?.kind ?? 'choice') as GameExercise['kind'];
    const groups = CATALOG.map((c) => ({
      module: c.module,
      games: c.ids.map((id) => ({ id, name: `Juego ${id}`, kind: kindOf(id) })),
    }));
    const exercise = vi.fn(async (_s: string, id: string): Promise<GameExercise> => ({
      token: `tok-${id}`,
      gameId: id,
      kind: 'choice',
      text: `Pregunta de ${id}`,
      options: [n(1), n(2)],
      ...SAMPLE[id],
    }));
    const answer = vi.fn(async (_s: string, _t: string, a: string[]) => ({ correct: true, correctAnswer: a, message: '¡Muy bien!' }));
    const { page, q, el, render } = setup({ list: vi.fn(async () => groups), exercise, answer });
    await render(); // la creación ya llamó a ngOnInit

    for (const [axis, group] of groups.entries()) {
      for (const game of group.games) {
        page.otherGame();
        await render();
        q(`axis-${axis}`)!.click();
        await render();
        q(`game-${game.id}`)!.click();
        await render();
        // Cada juego tiene su instrucción propia (no la genérica).
        expect(GAME_INSTRUCTIONS[game.id], game.id).toBeDefined();
        expect(el().textContent).toContain(GAME_INSTRUCTIONS[game.id]);
        expect(GAME_INSTRUCTIONS[game.id]).not.toBe(DEFAULT_INSTRUCTION);
        q('game-start')!.click();
        await render();
        expect(q('game-prompt')?.textContent, game.id).toContain(`Pregunta de ${game.id}`);
        const sample = SAMPLE[game.id] ?? {};
        if (sample.pattern) expect(q('visual-pattern'), game.id).not.toBeNull();
        if (sample.picto) expect(q('visual-picto'), game.id).not.toBeNull();
        if (sample.measure) expect(q('visual-measure'), game.id).not.toBeNull();
        if (sample.scene) expect(el().querySelector('[data-testid="scene-center"]'), game.id).not.toBeNull();
        if (game.kind === 'choice') {
          const first = (sample.options ?? [n(1)])[0].id;
          q(`option-${first}`)!.click();
        } else {
          // Ordenar o completar: se toca cada tarjeta del montón hasta llenar los lugares.
          let card: HTMLElement | null;
          while ((card = el().querySelector('[data-testid^="pool-"]:not([disabled])')) && q('order-ready')!.hasAttribute('disabled')) {
            card.click();
            await render();
          }
          q('order-ready')!.click();
        }
        await render();
        expect(q('game-result')?.textContent, game.id).toContain('¡Muy bien!');
      }
    }
    expect(answer).toHaveBeenCalledTimes(13);
  });

  it('5 rondas y resumen con jugar de nuevo, otro juego o volver a practicar; medalla a los 5 seguidos', async () => {
    const { page, nav, q, render } = setup();
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    for (let i = 0; i < ROUNDS; i++) {
      await page.pick('n:9');
      await page.nextRound();
    }
    await render();
    expect(page.step).toBe('summary');
    expect(q('game-summary')?.textContent).toContain(`¡Las ${ROUNDS} rondas bien!`);
    expect(page.medals).toBe(1);
    q('game-back')!.click();
    expect(nav.navigateBack).toHaveBeenCalledWith(['/practica', 'p1']);
    q('game-other')!.click();
    expect(page.step).toBe('axes');
  });

  it('no muestra nivel ni progreso', async () => {
    const { page, el, render } = setup();
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await render();
    expect(el().textContent).not.toMatch(/nivel|progreso/i);
  });

  it('sin internet: aviso para pedir ayuda a un adulto y reintentar', async () => {
    let fail = true;
    const { page, port, q, render } = setup({
      list: vi.fn(async () => {
        if (fail) throw new GameError('network');
        return GROUPS;
      }),
    });
    await render(); // la creación ya llamó a ngOnInit
    expect(q('game-notice')?.textContent).toContain(GAME_TEXT.offline);
    fail = false;
    q('game-retry')!.click();
    await render();
    expect(port.list).toHaveBeenCalledTimes(2);
    expect(page.step).toBe('axes');
  });

  it('si se pierde la red al responder, reintentar vuelve a mandar la misma respuesta', async () => {
    let fail = true;
    const answer = vi.fn(async () => {
      if (fail) throw new GameError('network');
      return { correct: true, correctAnswer: ['n:9'], message: '¡Muy bien!' };
    });
    const { page, q, render } = setup({ answer });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await page.pick('n:9');
    await render();
    expect(q('game-notice')?.textContent).toContain(GAME_TEXT.offline);
    fail = false;
    await page.retry();
    expect(answer).toHaveBeenLastCalledWith('p1', 'tok-c', ['n:9']);
    expect(page.result?.correct).toBe(true);
  });

  it('si la última respuesta ya estaba registrada (409), el resumen no arrastra el aviso', async () => {
    let n = 0;
    const answer = vi.fn(async () => {
      n += 1;
      if (n === ROUNDS) throw new GameError('already_answered');
      return { correct: true, correctAnswer: ['n:9'], message: '¡Muy bien!' };
    });
    const { page, q, render } = setup({ answer });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    for (let i = 0; i < ROUNDS - 1; i++) {
      await page.pick('n:9');
      await page.nextRound();
    }
    await page.pick('n:9');
    await render();
    expect(page.step).toBe('summary');
    expect(q('game-notice')?.textContent?.trim()).toBe('');
  });

  it('accesibilidad: resultado en una región viva fija, foco en "Siguiente" y Numi compacto', async () => {
    const { page, el, q, render, fixture } = setup({
      exercise: vi.fn(async () => ({ ...CHOICE, text: '¿Cuántas manzanas hay? 🍎🍎🍎' })),
    });
    document.body.appendChild(fixture.nativeElement);
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await render();
    // El grupo de opciones se nombra con el enunciado resumido, sin los emoji uno por uno.
    expect(el().querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('¿Cuántas manzanas hay? 3 manzanas');
    const live = el().querySelector('.result-area')!;
    expect(live.getAttribute('aria-live')).toBe('polite'); // existe ANTES de responder
    expect(el().querySelector('main')?.classList).toContain('in-round');
    await page.pick('n:9');
    await render();
    expect(el().querySelector('.result-area')).toBe(live); // la misma región, con texto nuevo
    expect(live.textContent).toContain('¡Muy bien!');
    // El foco llega después del próximo dibujo (afterNextRender): se espera a que ocurra.
    await vi.waitFor(() => expect(document.activeElement).toBe(q('game-next')));
    fixture.nativeElement.remove();
  });

  it('el resumen no dice "0 de 5"', () => {
    expect(GAME_TEXT.end(0, ROUNDS)).toBe('¡Terminaste! Jugando se aprende.');
    expect(GAME_TEXT.end(3, ROUNDS)).toBe(`¡Terminaste! Acertaste 3 de ${ROUNDS}.`);
  });

  it('curso no permitido (403): mensaje amable y vuelta a practicar', async () => {
    const { page, q, render } = setup({
      list: vi.fn(async () => {
        throw new GameError('grade');
      }),
    });
    await render(); // la creación ya llamó a ngOnInit
    expect(page.step).toBe('blocked');
    expect(q('game-notice')?.textContent).toContain(GAME_TEXT.grade);
    expect(q('game-retry')).toBeNull();
    expect(q('game-back')).not.toBeNull();
  });

  it('un ejercicio vencido se reemplaza en la misma ronda', async () => {
    let first = true;
    const answer = vi.fn(async () => {
      if (first) {
        first = false;
        throw new GameError('expired');
      }
      return { correct: true, correctAnswer: ['n:9'], message: '¡Muy bien!' };
    });
    const { page, port, render } = setup({ answer });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await page.pick('n:9');
    expect(port.exercise).toHaveBeenCalledTimes(2);
    expect(page.round).toBe(1);
  });

  it('los emoji repetidos del enunciado se resumen para el lector de pantalla', async () => {
    const { page, q, render } = setup({
      exercise: vi.fn(async () => ({ ...CHOICE, text: '¿Cuántas manzanas hay? 🍎🍎🍎' })),
    });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await render();
    const prompt = q('game-prompt')!;
    expect(prompt.querySelector('.glyphs')?.getAttribute('aria-hidden')).toBe('true');
    expect(prompt.querySelector('.sr-only')?.textContent).toContain('3 manzanas');
  });
});
