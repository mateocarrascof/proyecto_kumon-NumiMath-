import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { ChoiceOptionsComponent } from '../core/games/choice-options.component';
import { BagComponent } from '../core/games/bag.component';
import { EmojiRowsComponent } from '../core/games/emoji-rows.component';
import { GameVisualComponent } from '../core/games/game-visual.component';
import { DEFAULT_INSTRUCTION, GAME_INSTRUCTIONS, GAME_TEXT } from '../core/games/games.messages';
import { GameError, GameExercise, GamesPort } from '../core/games/games.port';
import { OrderCardsComponent } from '../core/games/order-cards.component';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { GamesPage, ROUNDS } from './games.page';
import { HARDWARE_BACK_PRIORITY } from '../core/navigation/hardware-back';

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

function setup(over: Partial<Record<keyof GamesPort, unknown>> = {}, query: Record<string, string> = {}) {
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
    imports: [IonicModule.forRoot(), ChoiceOptionsComponent, OrderCardsComponent, GameVisualComponent, EmojiRowsComponent, BagComponent],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: GamesPort, useValue: port },
      { provide: NavController, useValue: nav },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: { get: () => 'p1' }, queryParamMap: convertToParamMap(query) } },
      },
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

/** Simula el atrás de Android como Ionic: junta los manejadores y corre el de mayor prioridad. */
function pressHardwareBack(): number[] {
  const handlers: { priority: number; run: (next: () => void) => unknown }[] = [];
  document.dispatchEvent(
    new CustomEvent('ionBackButton', {
      detail: { register: (priority: number, run: (next: () => void) => unknown) => handlers.push({ priority, run }) },
    }),
  );
  handlers.sort((a, b) => b.priority - a.priority);
  void handlers[0]?.run(() => undefined);
  return handlers.map((h) => h.priority);
}
describe('GamesPage (CU-A21)', () => {
  it('"Practicar" de arriba lleva siempre a /practica/:id, también a mitad de una partida', async () => {
    const { page, q, nav, render } = setup({}, { juego: 'mayor-1' });
    await render();
    const top = q('games-top-back')!;
    expect(top.textContent).toContain('Practicar');
    expect(document.querySelector('ion-back-button')).toBeNull(); // no depende del historial
    top.click();
    expect(nav.navigateBack).toHaveBeenLastCalledWith(['/practica', 'p1']);
    await page.start();
    await render();
    expect(page.step).toBe('round');
    q('games-top-back')!.click();
    expect(nav.navigateBack).toHaveBeenLastCalledWith(['/practica', 'p1']);
    expect(nav.navigateBack).toHaveBeenCalledTimes(2);
  });

  it('atrás de Android: a /practica/:id también a mitad de una partida, y se suelta al salir', async () => {
    const { page, nav, render } = setup({}, { juego: 'mayor-1' });
    await render();
    await page.start();
    await render();
    expect(page.step).toBe('round');
    page.ionViewDidEnter();
    expect(pressHardwareBack()).toContain(HARDWARE_BACK_PRIORITY);
    expect(nav.navigateBack).toHaveBeenCalledWith(['/practica', 'p1']);
    page.ionViewWillLeave();
    expect(pressHardwareBack()).not.toContain(HARDWARE_BACK_PRIORITY);
    expect(nav.navigateBack).toHaveBeenCalledTimes(1);
  });

  it('muestra los ejes y, al elegir uno, sus juegos', async () => {    const { page, q, render } = setup();
    await render(); // la creación ya llamó a ngOnInit
    expect(page.step).toBe('axes');
    q('axis-0')!.click();
    await render();
    expect(q('game-mayor-1')?.textContent).toContain('¿Cuál es mayor?');
    expect(q('game-ordena-1')).not.toBeNull();
  });

  describe('atajos desde "Aprender jugando"', () => {
    const SKILLED = [
      {
        module: 'Números y operaciones',
        games: [
          { id: 'mayor-1', name: '¿Cuál es mayor?', kind: 'choice' as const, skill: '1-03' },
          { id: 'ordena-1', name: 'Ordena los números', kind: 'order' as const, skill: '1-03' },
          { id: 'cuantos-1', name: '¿Cuántos hay?', kind: 'choice' as const, skill: '1-02' },
        ],
      },
    ];

    it('?juego= abre directo la introducción de ese juego', async () => {
      const { page, el, render } = setup({ list: vi.fn(async () => SKILLED) }, { juego: 'ordena-1' });
      await render(); // la creación ya llamó a ngOnInit
      expect(page.step).toBe('intro');
      expect(page.game?.id).toBe('ordena-1');
      expect(el().textContent).toContain('Pon los números de menor a mayor.');
    });

    it('?tema= muestra solo los juegos de ese tema, sin elegir eje', async () => {
      const { page, q, render } = setup({ list: vi.fn(async () => SKILLED) }, { tema: '1-03' });
      await render();
      expect(page.step).toBe('games');
      expect(q('game-mayor-1')).not.toBeNull();
      expect(q('game-ordena-1')).not.toBeNull();
      expect(q('game-cuantos-1')).toBeNull();
    });

    it('un juego o tema desconocido deja la elección de eje, como siempre', async () => {
      const { page, render } = setup({ list: vi.fn(async () => SKILLED) }, { juego: 'no-existe', tema: '9-99' });
      await render();
      expect(page.step).toBe('axes');
    });
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

  it('en la ronda, Numi va en la cabecera junto a "Ronda N de 5" y el enunciado (un solo Numi)', async () => {
    const { page, el, q, render } = setup();
    await render();
    page.chooseGame(GROUPS[0].games[0]);
    await render();
    expect(el().querySelectorAll('app-mascot')).toHaveLength(1); // introducción: Numi arriba, con su burbuja
    expect(el().querySelector('.round-head app-mascot')).toBeNull();
    await page.start();
    await render();
    const head = el().querySelector('.round-head')!;
    expect(el().querySelectorAll('app-mascot')).toHaveLength(1);
    expect(head.querySelector('app-mascot')).not.toBeNull();
    expect(head.querySelector('[data-testid="game-round"]')).toBe(q('game-round'));
    expect(head.querySelector('[data-testid="game-prompt"]')).toBe(q('game-prompt'));
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
      'pon-en-bolsa-1': { text: 'Pregunta de pon-en-bolsa-1 ⚽⚽⚽', options: [n(3), n(2)] },
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
      { module: 'Números y operaciones', ids: ['pon-en-bolsa-1', 'ordena-1', 'completa-camino-1', 'descompone-1', 'junta-1'] },
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

    // Los ejes listan todos los grupos; cada juego se abre directo (como desde su tema).
    expect(el().querySelectorAll('[data-testid^="axis-"]').length).toBe(groups.length);
    for (const group of groups) {
      for (const game of group.games) {
        page.chooseGame(game);
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
          // La bolsa: las opciones se habilitan con todos los objetos dentro.
          let item: HTMLElement | null;
          while ((item = el().querySelector('[data-testid^="bag-put-"]'))) {
            item.click();
            await render();
          }
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
    expect(answer).toHaveBeenCalledTimes(11); // un juego por tema (11 temas de 1°)
  });

  it('recorre el catálogo de 2°: cada juego abre, se juega y corrige', async () => {
    const n = (v: number) => ({ id: `n:${v}`, kind: 'number', label: String(v) });
    const SAMPLE: Record<string, Partial<GameExercise>> = {
      'cuenta-mil-2': { kind: 'fill', options: [n(100), n(200), n(300), n(350)], slots: ['n:100', 'n:200', null] },
      'completa-patron-2': { kind: 'fill', options: [n(20), n(15), n(10), n(11)], slots: ['n:20', 'n:15', null] },
      'ordena-2': { kind: 'order', options: [n(50), n(20)] },
      'arma-numero-2': { options: [n(47), n(74)], blocks: { tens: 4, ones: 7 } },
      'suma-bloques-2': { options: [n(41), n(31)], blocks: { tens: 3, ones: 11 } },
      'cuenta-lados-2': { options: [n(5), n(6)], figure: { id: 'f:pentagono-rojo', kind: 'figure', label: 'pentágono rojo' } },
      'elige-unidad-2': { options: [{ id: 's:cm', kind: 'symbol', label: 'cm' }, { id: 's:m', kind: 'symbol', label: 'm' }] },
      'lee-reloj-2': { options: [{ id: 't:3-30', kind: 'time', label: '3:30' }, { id: 't:3-00', kind: 'time', label: '3:00' }], clock: { hour: 3, minute: 30 } },
      'pictograma-escala-2': { options: [n(6), n(3)], picto: [{ glyph: '⭐', name: 'estrellas', count: 3 }], scale: 2 },
    };
    const CATALOG = [
      { module: 'Números y operaciones', ids: ['ordena-2', 'cuenta-mil-2', 'lee-numero-2', 'arma-numero-2', 'suma-bloques-2', 'grupos-iguales-2'] },
      { module: 'Patrones y álgebra', ids: ['compara-signo-2', 'completa-patron-2'] },
      { module: 'Geometría', ids: ['cuenta-lados-2'] },
      { module: 'Medición', ids: ['elige-unidad-2', 'lee-reloj-2'] },
      { module: 'Datos y probabilidades', ids: ['pictograma-escala-2'] },
    ];
    const kindOf = (id: string) => (SAMPLE[id]?.kind ?? 'choice') as GameExercise['kind'];
    const groups = CATALOG.map((c) => ({ module: c.module, games: c.ids.map((id) => ({ id, name: `Juego ${id}`, kind: kindOf(id) })) }));
    const exercise = vi.fn(async (_s: string, id: string): Promise<GameExercise> => ({
      token: `tok-${id}`, gameId: id, kind: 'choice', text: `Pregunta de ${id}`, options: [n(1), n(2)], ...SAMPLE[id],
    }));
    const answer = vi.fn(async (_s: string, _t: string, a: string[]) => ({ correct: true, correctAnswer: a, message: '¡Muy bien!' }));
    const { page, q, el, render } = setup({ list: vi.fn(async () => groups), exercise, answer });
    await render(); // la creación ya llamó a ngOnInit
    // Los ejes listan todos los grupos; cada juego se abre directo (como desde su tema).
    expect(el().querySelectorAll('[data-testid^="axis-"]').length).toBe(groups.length);
    for (const group of groups) {
      for (const game of group.games) {
        page.chooseGame(game);
        await render();
        expect(GAME_INSTRUCTIONS[game.id], game.id).toBeDefined();
        q('game-start')!.click();
        await render();
        if (SAMPLE[game.id]?.blocks) expect(q('visual-blocks'), game.id).not.toBeNull();
        if (SAMPLE[game.id]?.figure) expect(q('visual-figure'), game.id).not.toBeNull();
        if (SAMPLE[game.id]?.clock) expect(q('visual-clock'), game.id).not.toBeNull();
        if (SAMPLE[game.id]?.scale) expect(q('visual-picto'), game.id).not.toBeNull();
        if (game.kind === 'choice') {
          q(`option-${(SAMPLE[game.id]?.options ?? [n(1)])[0].id}`)!.click();
        } else {
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
    expect(answer).toHaveBeenCalledTimes(12); // un juego por tema (12 temas de 2°)
  });

  it('bolsa: las opciones esperan a que estén todos dentro; sacar uno las vuelve a deshabilitar', async () => {
    const BAG: GameExercise = {
      token: 'tok-b',
      gameId: 'pon-en-bolsa-1',
      kind: 'choice',
      text: 'Mete las pelotas en la bolsa. ¿Cuántas hay? ⚽⚽',
      options: [
        { id: 'n:2', kind: 'number', label: '2' },
        { id: 'n:3', kind: 'number', label: '3' },
      ],
    };
    const answer = vi.fn(async () => ({ correct: true, correctAnswer: ['n:2'], message: '¡Muy bien!' }));
    const { page, q, el, render } = setup({ exercise: vi.fn(async () => BAG), answer });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame({ id: 'pon-en-bolsa-1', name: 'Cuenta con la bolsa', kind: 'choice' });
    await page.start();
    await render();
    const disabled = () => (q('option-n:2') as HTMLButtonElement).disabled;
    expect(el().querySelector('[data-testid="emoji-block"]')).toBeNull(); // objetos sueltos, no la fila
    expect(q('game-prompt')!.textContent).not.toContain('⚽');
    expect(disabled()).toBe(true);
    q('bag-put-0')!.click();
    await render();
    expect(disabled()).toBe(true); // falta uno
    q('bag-put-1')!.click();
    await render();
    expect(disabled()).toBe(false);
    q('bag-take-0')!.click(); // sacar uno
    await render();
    expect(disabled()).toBe(true);
    q('bag-put-0')!.click();
    await render();
    q('option-n:2')!.click();
    await render();
    expect(answer).toHaveBeenCalledWith('p1', 'tok-b', ['n:2']);
  });

  it('5 rondas y resumen con jugar de nuevo o volver a practicar; medalla a los 5 seguidos', async () => {
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
    // Sin "Otro juego" ni vuelta a la elección de eje (este tema tiene un solo juego).
    expect(q('game-other')).toBeNull();
    expect(page.step).toBe('summary');
  });

  it('un tema con varios juegos: el resumen ofrece "Otro juego de este tema" (solo los de su tema)', async () => {
    // Catálogo de prueba: el real tiene un juego listado por tema, pero el botón se conserva.
    const same = [
      { id: 'mayor-1', name: '¿Cuál es mayor?', kind: 'choice' as const, skill: '1-03' },
      { id: 'ordena-1', name: 'Ordena los números', kind: 'order' as const, skill: '1-03' },
    ];
    const other = { id: 'cuantos-1', name: '¿Cuántos hay?', kind: 'choice' as const, skill: '1-02' };
    const { page, q, render } = setup({ list: vi.fn(async () => [{ module: 'Números y operaciones', games: [...same, other] }]) });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(same[0]);
    await page.start();
    for (let i = 0; i < ROUNDS; i++) {
      await page.pick('n:9');
      await page.nextRound();
    }
    await render();
    expect(q('game-other')?.textContent).toContain('Otro juego de este tema');
    q('game-other')!.click();
    await render();
    expect(page.step).toBe('games');
    expect(q('game-ordena-1')).not.toBeNull();
    expect(q('game-cuantos-1')).toBeNull(); // nada de otro tema
    expect(q('axis-0')).toBeNull(); // sin elección de eje
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
    // Los emoji van en su bloque (una imagen con la cantidad) y la pregunta, debajo y sin emoji.
    const block = q('emoji-block')!;
    expect(block.getAttribute('role')).toBe('img');
    expect(block.getAttribute('aria-label')).toBe('3 manzanas');
    expect(block.querySelector('[data-testid="glyph-group"]')!.classList).not.toContain('boxed');
    expect(q('game-prompt')!.textContent).not.toContain('🍎');
  });

  it('"5 = 3 + ?": el lector de pantalla oye la pregunta completa (el "?" se dice)', async () => {
    const { page, q, el, render } = setup({
      exercise: vi.fn(async () => ({ ...CHOICE, text: '5 = 3 + ? 🍎🍎🍎' })),
    });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await render();
    expect(q('prompt-spoken')?.textContent).toBe('5 es igual a 3 más ¿cuántas manzanas?');
    expect(el().querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      '5 es igual a 3 más ¿cuántas manzanas? 3 manzanas',
    );
  });

  it('juntar: cada grupo de emoji va en su recuadro (a 360 px no se mezclan)', async () => {
    const { page, q, render } = setup({
      exercise: vi.fn(async () => ({ ...CHOICE, text: 'Junta las flores. ¿Cuántas hay? 🌸🌸🌸🌸🌸🌸🌸🌸🌸 🌸🌸🌸🌸🌸🌸🌸🌸🌸' })),
    });
    await render(); // la creación ya llamó a ngOnInit
    page.chooseGame(GROUPS[0].games[0]);
    await page.start();
    await render();
    const groups = [...q('emoji-block')!.querySelectorAll('[data-testid="glyph-group"]')];
    expect(groups.map((g) => g.textContent)).toEqual(['🌸'.repeat(9), '🌸'.repeat(9)]);
    expect(groups.every((g) => g.classList.contains('boxed'))).toBe(true);
    // En filas de 5: un grupo de 9 son 5 + 4 (la última fila a la izquierda).
    expect((groups[0] as HTMLElement).style.gridTemplateColumns).toContain('repeat(5');
    expect(q('emoji-block')!.getAttribute('aria-label')).toBe('9 flores y 9 flores');
  });
});
