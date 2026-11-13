import { TestBed } from '@angular/core/testing';

import { ChoiceOptionsComponent, OPTION_LETTERS, OPTION_POSITION_COLORS } from './choice-options.component';
import { GAME_TEXT } from './games.messages';
import { GameOption } from './games.port';
import { OrderCardsComponent } from './order-cards.component';

const N = (v: number): GameOption => ({ id: `n:${v}`, kind: 'number', label: String(v) });
const APPLES: GameOption = { id: 'e:manzana-3', kind: 'emoji', label: '🍎🍎🍎' };

describe('ChoiceOptionsComponent (CU-A21)', () => {
  function render(inputs: Partial<ChoiceOptionsComponent> = {}) {
    TestBed.configureTestingModule({ imports: [ChoiceOptionsComponent] });
    const fixture = TestBed.createComponent(ChoiceOptionsComponent);
    fixture.componentRef.setInput('options', [N(4), N(9), APPLES]);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (id: string) => el.querySelector(`[data-testid="option-${id}"]`) as HTMLButtonElement;
    return { fixture, el, button };
  }

  it('muestra un botón grande por opción y emite la elegida', () => {
    const { fixture, button } = render();
    const picks: string[] = [];
    fixture.componentInstance.pick.subscribe((id) => picks.push(id));
    button('n:9').click();
    expect(picks).toEqual(['n:9']);
  });

  it('etiquetas accesibles: el emoji repetido se resume ("3 manzanas")', () => {
    const { el, button } = render();
    expect(button('e:manzana-3').getAttribute('aria-label')).toBe('3 manzanas');
    expect(button('e:manzana-3').querySelector('.value')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('[role="group"]')).not.toBeNull();
  });

  it('se muestran en el orden del servidor (mezclado), sin reordenar por contenido', () => {
    const { el } = render({ options: [N(9), APPLES, N(4)] } as Partial<ChoiceOptionsComponent>);
    const ids = [...el.querySelectorAll('[data-testid^="option-"]')].map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual(['option-n:9', 'option-e:manzana-3', 'option-n:4']);
  });

  it('estado elegido con aria-pressed', () => {
    const { button } = render({ chosen: 'n:4' });
    expect(button('n:4').getAttribute('aria-pressed')).toBe('true');
    expect(button('n:9').getAttribute('aria-pressed')).toBe('false');
  });

  it('tras corregir, cada estado lleva texto (no solo color)', () => {
    const { button } = render({ chosen: 'n:4', correct: ['n:9'], disabled: true });
    expect(button('n:9').textContent).toContain(GAME_TEXT.correctBadge);
    expect(button('n:9').getAttribute('aria-label')).toContain(GAME_TEXT.correctBadge);
    expect(button('n:4').textContent).toContain(GAME_TEXT.chosenBadge);
    expect(button('e:manzana-3').textContent).not.toContain(GAME_TEXT.chosenBadge);
  });

  it('desactivado no emite', () => {
    const { fixture, button } = render({ disabled: true });
    const picks: string[] = [];
    fixture.componentInstance.pick.subscribe((id) => picks.push(id));
    button('n:4').click();
    expect(picks).toEqual([]);
  });
});

/** Contraste WCAG 2.x entre dos colores #rrggbb. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b2);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('ChoiceOptionsComponent: color y letra por posición', () => {
  const FOUR = [N(4), N(9), APPLES, N(7)];
  function render(inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ imports: [ChoiceOptionsComponent] });
    const fixture = TestBed.createComponent(ChoiceOptionsComponent);
    fixture.componentRef.setInput('options', FOUR);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const look = () =>
      [...el.querySelectorAll<HTMLElement>('[data-testid^="option-"]')].map((b) => ({
        pos: b.getAttribute('data-pos'),
        bg: b.style.getPropertyValue('--pos-bg'),
        accent: b.style.getPropertyValue('--pos-accent'),
        letter: b.querySelector('[data-testid="choice-letter"]')?.textContent?.trim() ?? null,
      }));
    return { fixture, el, look };
  }

  it('cada posición tiene su color y su letra A, B, C, D (solo visual)', () => {
    const { el, look } = render();
    expect(look()).toEqual(
      OPTION_POSITION_COLORS.map((c, i) => ({ pos: String(i + 1), bg: c.bg, accent: c.accent, letter: OPTION_LETTERS[i] })),
    );
    for (const l of el.querySelectorAll('[data-testid="choice-letter"]')) {
      expect(l.getAttribute('aria-hidden')).toBe('true');
    }
    // La etiqueta accesible no cambia por la letra.
    expect(el.querySelector('[data-testid="option-n:9"]')?.getAttribute('aria-label')).toBe('9');
  });

  it('el color depende del lugar, no de cuál es la correcta, y no cambia al responder', () => {
    const { fixture, look } = render();
    const before = look();
    fixture.componentRef.setInput('chosen', 'n:9');
    fixture.detectChanges();
    expect(look()).toEqual(before);
    fixture.componentRef.setInput('correct', ['n:7']);
    fixture.detectChanges();
    expect(look()).toEqual(before);
    // Otra correcta: los mismos colores por lugar.
    TestBed.resetTestingModule();
    expect(render({ correct: ['n:4'], chosen: 'n:4' }).look()).toEqual(before);
  });

  it('con otro orden, cada lugar mantiene su color (sigue al lugar, no a la opción)', () => {
    const { look } = render({ options: [N(7), APPLES, N(9), N(4)] });
    expect(look().map((l) => l.bg)).toEqual(OPTION_POSITION_COLORS.map((c) => c.bg));
  });

  it('escena en cruz: color por posición, sin letras', () => {
    const scene = {
      center: '📦',
      places: [
        { id: 'n:4', position: 'arriba' },
        { id: 'n:9', position: 'izquierda' },
        { id: 'e:manzana-3', position: 'derecha' },
        { id: 'n:7', position: 'abajo' },
      ],
    };
    const { el, look } = render({ scene });
    expect(el.querySelector('[data-testid="choice-letter"]')).toBeNull();
    expect(look().map((l) => l.bg)).toEqual(OPTION_POSITION_COLORS.map((c) => c.bg));
  });

  it('contraste WCAG AA: texto sobre el fondo ≥ 4,5; acento sobre el fondo ≥ 3; letra blanca ≥ 4,5', () => {
    for (const { bg, accent } of OPTION_POSITION_COLORS) {
      expect(contrast('#1a202c', bg), bg).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, bg), accent).toBeGreaterThanOrEqual(3);
      expect(contrast('#ffffff', accent), accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('sin verde ni naranjo de "Esta era" / "Tu elección" en la paleta', () => {
    const states = ['#1e7a3a', '#e6f6ea', '#8a4b00', '#fff4e5'];
    for (const { bg, accent } of OPTION_POSITION_COLORS) {
      expect(states).not.toContain(bg);
      expect(states).not.toContain(accent);
    }
  });
});

describe('OrderCardsComponent (CU-A21)', () => {
  function render(inputs: Partial<OrderCardsComponent> = {}) {
    TestBed.configureTestingModule({ imports: [OrderCardsComponent] });
    const fixture = TestBed.createComponent(OrderCardsComponent);
    fixture.componentRef.setInput('cards', [N(7), N(2), N(5)]);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const c = fixture.componentInstance;
    return { fixture, el, q, c };
  }

  it('tocar pone cada tarjeta en el primer lugar libre y avisa al lector de pantalla', () => {
    const { fixture, q, c } = render();
    q('pool-n:2').click();
    fixture.detectChanges();
    expect(c.placed).toEqual(['n:2', null, null]);
    expect(q('order-live').textContent).toContain('Pusiste 2 en el lugar 1');
    expect(q('order-live').getAttribute('aria-live')).toBe('polite');
  });

  it('tocar una tarjeta puesta la devuelve al montón', () => {
    const { fixture, q, c } = render();
    q('pool-n:2').click();
    fixture.detectChanges();
    q('slot-card-0').click();
    fixture.detectChanges();
    expect(c.placed).toEqual([null, null, null]);
    expect(q('pool-n:2')).not.toBeNull();
  });

  it('"Listo" se activa solo con todas puestas y entrega el orden', () => {
    const { fixture, q, c } = render();
    const answers: string[][] = [];
    c.ready.subscribe((a) => answers.push(a));
    expect((q('order-ready') as HTMLButtonElement).disabled).toBe(true);
    for (const id of ['n:2', 'n:5', 'n:7']) {
      q(`pool-${id}`).click();
      fixture.detectChanges();
    }
    expect((q('order-ready') as HTMLButtonElement).disabled).toBe(false);
    q('order-ready').click();
    expect(answers).toEqual([['n:2', 'n:5', 'n:7']]);
  });

  it('teclado: las flechas mueven una tarjeta puesta de lugar', () => {
    const { fixture, q, c } = render();
    for (const id of ['n:7', 'n:2']) {
      q(`pool-${id}`).click();
      fixture.detectChanges();
    }
    q('slot-card-0').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(c.placed).toEqual(['n:2', 'n:7', null]);
    expect(q('order-live').textContent).toContain('Moviste 7 al lugar 2');
  });

  it('arrastrar (alternativa): soltar sobre un lugar pone o intercambia', () => {
    const { c } = render();
    c.dropOn('n:5', 2);
    expect(c.placed).toEqual([null, null, 'n:5']);
    c.dropOn('n:7', 2); // la que estaba vuelve al montón
    expect(c.placed).toEqual([null, null, 'n:7']);
    c.dropOn('n:2', 0);
    c.dropOn('n:2', 2); // desde un lugar: intercambia
    expect(c.placed).toEqual(['n:7', null, 'n:2']);
  });

  it('un toque corto no cuenta como arrastre (se maneja como toque)', () => {
    const { fixture, q, c } = render();
    const card = q('pool-n:7');
    card.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10, button: 0 }));
    card.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 12, clientY: 11 }));
    card.click();
    fixture.detectChanges();
    expect(c.placed).toEqual(['n:7', null, null]);
  });

  it('si tras arrastrar no llega el "click", el próximo toque igual funciona', async () => {
    const { fixture, q, c } = render();
    const card = q('pool-n:7');
    card.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 0, clientY: 0, button: 0 }));
    card.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 40, clientY: 40 }));
    card.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: 40, clientY: 40 }));
    // Sin "click" del navegador: la bandera se limpia sola.
    await new Promise((r) => setTimeout(r, 0));
    q('pool-n:2').click();
    fixture.detectChanges();
    expect(c.placed).toContain('n:2');
  });

  it('teclado: el foco sigue a la tarjeta al ponerla y al sacarla', async () => {
    const { fixture, q } = render();
    document.body.appendChild(fixture.nativeElement);
    q('pool-n:7').click();
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('data-testid')).toBe('pool-n:2'), // la siguiente
    );
    q('slot-card-0').click();
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('data-testid')).toBe('pool-n:7'), // volvió al montón
    );
    fixture.nativeElement.remove();
  });

  it('lugares vacíos y ocupados tienen nombre para el lector de pantalla', () => {
    const { fixture, q, el } = render();
    expect(q('slot-empty-0').textContent).toContain('Lugar 1, vacío');
    q('pool-n:5').click();
    fixture.detectChanges();
    expect(q('slot-card-0').getAttribute('aria-label')).toContain('5 en el lugar 1');
    expect(el.querySelector('ol')?.getAttribute('aria-label')).toBe(GAME_TEXT.orderSlots);
  });

  it('completar: los lugares ya ocupados no se mueven ni se sacan', () => {
    const { fixture, q, c } = render({ cards: [N(1), N(2), N(3)], slots: ['n:1', null, 'n:3'] });
    expect(c.pool().map((x) => x.id)).toEqual(['n:2']);
    expect((q('slot-card-0') as HTMLButtonElement).disabled).toBe(true);
    q('pool-n:2').click();
    fixture.detectChanges();
    expect(c.placed).toEqual(['n:1', 'n:2', 'n:3']);
    c.move(1, -1);
    expect(c.placed).toEqual(['n:1', 'n:2', 'n:3']);
  });

  it('tras corregir muestra el orden correcto y marca con ✓ los lugares bien puestos', () => {
    const { fixture, q, el } = render();
    for (const id of ['n:2', 'n:7', 'n:5']) {
      q(`pool-${id}`).click();
      fixture.detectChanges();
    }
    fixture.componentRef.setInput('correct', ['n:2', 'n:5', 'n:7']);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(q('order-answer').textContent).toContain('2, 5, 7');
    expect(el.querySelectorAll('.ok')).toHaveLength(1);
    expect(q('order-ready')).toBeNull();
  });
});
