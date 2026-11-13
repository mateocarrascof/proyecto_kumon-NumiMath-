import { TestBed } from '@angular/core/testing';

import { ChoiceOptionsComponent } from './choice-options.component';
import { FigureComponent } from './figure.component';
import { GameVisualComponent, MEASURE_UNIT_PX } from './game-visual.component';
import { GameExercise, GameOption } from './games.port';

/** Figuras, escena, pictograma y medición (CU-A21, parte 3). */

const FIG = (shape: string, color: string, label: string): GameOption => ({
  id: `f:${shape}-${color}`,
  kind: 'figure',
  label,
});

function base(over: Partial<GameExercise>): GameExercise {
  return { token: 't', gameId: 'x', kind: 'choice', text: '¿?', options: [], ...over };
}

describe('FigureComponent (CU-A21)', () => {
  const SHAPES = ['circulo', 'cuadrado', 'triangulo', 'rectangulo', 'cubo', 'esfera', 'cilindro', 'pentagono', 'hexagono'];

  beforeEach(() => TestBed.configureTestingModule({ imports: [FigureComponent] }));

  function draw(id: string) {
    const fixture = TestBed.createComponent(FigureComponent);
    fixture.componentRef.setInput('figureId', id);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('svg') as SVGElement;
  }

  it('cada forma tiene un dibujo distinto (no solo otro color) y el SVG es decorativo', () => {
    const drawings = SHAPES.map((s) => {
      const svg = draw(`f:${s}-rojo`);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('data-shape')).toBe(s);
      return svg.querySelector('g')!.innerHTML.replace(/<!--.*?-->/g, '');
    });
    expect(new Set(drawings).size).toBe(SHAPES.length);
    // Borde oscuro grueso en todas: la forma se ve aunque no se distinga el color.
    expect(draw('f:circulo-amarillo').querySelector('g')!.getAttribute('stroke')).toBe('#1a202c');
  });

  it('el color sale del id; uno desconocido se dibuja gris', () => {
    expect(draw('f:cubo-azul').querySelector('g')!.getAttribute('fill')).toBe('#3182ce');
    expect(draw('f:cubo-fucsia').querySelector('g')!.getAttribute('fill')).toBe('#cbd5e0');
  });
});

describe('ChoiceOptionsComponent: figuras y escena (CU-A21)', () => {
  function render(options: GameOption[], scene: GameExercise['scene'] = null) {
    TestBed.configureTestingModule({ imports: [ChoiceOptionsComponent] });
    const fixture = TestBed.createComponent(ChoiceOptionsComponent);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('scene', scene);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (id: string) => el.querySelector(`[data-testid="option-${id}"]`) as HTMLElement;
    return { el, button };
  }

  it('una figura se dibuja y su etiqueta dice nombre y color', () => {
    const { button } = render([FIG('triangulo', 'rojo', 'triángulo rojo'), FIG('esfera', 'azul', 'esfera azul')]);
    expect(button('f:triangulo-rojo').querySelector('app-figure svg')).not.toBeNull();
    expect(button('f:triangulo-rojo').getAttribute('aria-label')).toBe('triángulo rojo');
    expect(button('f:triangulo-rojo').textContent?.trim()).toBe(''); // el nombre no se ve: hay que reconocer la forma
  });

  it('escena en cruz: la caja al centro y cada objeto en su lugar, con su posición en la etiqueta', () => {
    const objects: GameOption[] = [
      { id: 'e:pelota-1', kind: 'emoji', label: '⚽' },
      { id: 'e:flor-1', kind: 'emoji', label: '🌸' },
      { id: 'e:estrella-1', kind: 'emoji', label: '⭐' },
      { id: 'e:manzana-1', kind: 'emoji', label: '🍎' },
    ];
    const { el, button } = render(objects, {
      center: '📦',
      centerName: 'caja',
      places: [
        { position: 'arriba', id: 'e:pelota-1' },
        { position: 'izquierda', id: 'e:flor-1' },
        { position: 'derecha', id: 'e:estrella-1' },
        { position: 'abajo', id: 'e:manzana-1' },
      ],
    });
    expect(el.querySelector('.options')!.classList).toContain('scene');
    expect(el.querySelector('[data-testid="scene-center"]')!.textContent).toContain('📦');
    expect(button('e:pelota-1').style.gridArea).toContain('arriba');
    expect(button('e:pelota-1').getAttribute('aria-label')).toBe('pelota, arriba');
    expect(button('e:flor-1').getAttribute('aria-label')).toBe('flor, a la izquierda');
    expect(button('e:estrella-1').getAttribute('aria-label')).toBe('estrella, a la derecha');
    expect(button('e:manzana-1').getAttribute('aria-label')).toBe('manzana, abajo');
  });
});

describe('GameVisualComponent (CU-A21)', () => {
  function render(exercise: GameExercise) {
    TestBed.configureTestingModule({ imports: [GameVisualComponent] });
    const fixture = TestBed.createComponent(GameVisualComponent);
    fixture.componentRef.setInput('exercise', exercise);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    return { el, q };
  }

  it('sin nada que dibujar no muestra nada', () => {
    const { el } = render(base({}));
    expect(el.textContent?.trim()).toBe('');
  });

  it('patrón: fila de figuras con "?" y una descripción en orden para el lector de pantalla', () => {
    const { q } = render(
      base({
        pattern: [
          FIG('circulo', 'rojo', 'círculo rojo'),
          FIG('cuadrado', 'azul', 'cuadrado azul'),
          FIG('circulo', 'rojo', 'círculo rojo'),
          FIG('cuadrado', 'azul', 'cuadrado azul'),
        ],
      }),
    );
    const row = q('visual-pattern')!;
    expect(row.querySelectorAll('app-figure').length).toBe(4);
    expect(row.getAttribute('role')).toBe('img');
    expect(row.getAttribute('aria-label')).toBe(
      'En la fila: círculo rojo, cuadrado azul, círculo rojo, cuadrado azul. ¿Qué sigue?',
    );
  });

  it('pictograma: una fila por categoría; los emoji se ocultan y la cantidad se dice', () => {
    const { q } = render(
      base({
        picto: [
          { glyph: '🍎', name: 'manzanas', count: 3 },
          { glyph: '⚽', name: 'pelotas', count: 5 },
        ],
      }),
    );
    const rows = q('visual-picto')!.querySelectorAll('tr');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('th')!.textContent).toContain('manzanas');
    expect(rows[0].querySelector('[aria-hidden="true"]')!.textContent!.trim()).toBe('🍎🍎🍎');
    expect(rows[0].querySelector('.sr-only')!.textContent).toBe('3');
    expect(q('visual-picto')!.querySelector('caption')!.textContent).toContain('Pictograma');
  });

  it('pictograma: 8 emoji van en grupos de 5 y 3, que pueden pasar a otra línea sin cortarse (360 px)', () => {
    const { q } = render(base({ picto: [{ glyph: '⭐', name: 'estrellas', count: 8 }] }));
    const groups = [...q('visual-picto')!.querySelectorAll('.five')].map((g) => g.textContent);
    expect(groups).toEqual(['⭐⭐⭐⭐⭐', '⭐⭐⭐']);
  });

  it('figura grande: se dibuja y su etiqueta dice nombre y color', () => {
    const { q } = render(base({ figure: FIG('hexagono', 'verde', 'hexágono verde') }));
    const fig = q('visual-figure')!;
    expect(fig.getAttribute('aria-label')).toBe('hexágono verde');
    expect(fig.querySelector('svg')!.getAttribute('data-shape')).toBe('hexagono');
  });

  it('reloj: manecilla corta gruesa y larga fina; se describe sin decir la hora', () => {
    const { q } = render(base({ clock: { hour: 3, minute: 30 } }));
    const clock = q('visual-clock')!;
    expect(clock.querySelectorAll('text').length).toBe(12);
    const hourHand = clock.querySelector('.hour-hand')!;
    const minuteHand = clock.querySelector('.minute-hand')!;
    expect(Number(hourHand.getAttribute('stroke-width'))).toBeGreaterThan(Number(minuteHand.getAttribute('stroke-width')));
    expect(minuteHand.getAttribute('x2')).toBe('60'); // la larga en el 6: abajo
    expect(Number(minuteHand.getAttribute('y2'))).toBeGreaterThan(60);
    expect(clock.getAttribute('aria-label')).toBe('Reloj: la manecilla corta está entre el 3 y el 4 y la larga en el 6.');
    expect(clock.getAttribute('aria-label')).not.toMatch(/media|:30/);
  });

  it('pictograma con escala: el lector oye cuántos íconos (no el total)', () => {
    const { q } = render(base({ picto: [{ glyph: '⭐', name: 'estrellas', count: 3 }], scale: 2 }));
    expect(q('visual-picto')!.querySelector('.sr-only:not(caption)')!.textContent).toBe('3 íconos');
  });

  it('bloques: barras de diez y cubitos, descritos sin decir el número', () => {
    const { q } = render(base({ blocks: { tens: 4, ones: 1 } }));
    const blocks = q('visual-blocks')!;
    expect(blocks.querySelectorAll('.rod').length).toBe(4);
    expect(blocks.querySelectorAll('.rod')[0].querySelectorAll('rect').length).toBe(10);
    expect(blocks.querySelectorAll('.cube').length).toBe(1);
    expect(blocks.getAttribute('role')).toBe('img');
    expect(blocks.getAttribute('aria-label')).toBe('4 barras de diez y 1 cubito');
    expect(blocks.getAttribute('aria-label')).not.toContain('41');
  });

  it('medición: lo medido tiene el mismo largo que la fila de clips, y cada clip se puede contar', () => {
    const { q } = render(
      base({ measure: { thing: 'lapiz', name: 'el lápiz', unit: 'clip', glyph: '📎', length: 5 } }),
    );
    const fig = q('visual-measure')!;
    expect(fig.querySelector('svg')!.getAttribute('width')).toBe(String(5 * MEASURE_UNIT_PX));
    const items = fig.querySelectorAll('ul li');
    expect(items.length).toBe(5);
    expect(items[0].querySelector('.sr-only')!.textContent).toBe('clip');
    expect(fig.querySelector('ul')!.getAttribute('aria-label')).toBe('Clips');
    expect(fig.querySelector('figcaption')!.textContent).toBe('El lápiz y, debajo, clips en fila.');
  });
});
