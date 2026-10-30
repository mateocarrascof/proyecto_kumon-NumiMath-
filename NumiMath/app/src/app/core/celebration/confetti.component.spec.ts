import { TestBed } from '@angular/core/testing';

import { ConfettiComponent } from './confetti.component';

function setup() {
  TestBed.configureTestingModule({ declarations: [ConfettiComponent] });
  const fixture = TestBed.createComponent(ConfettiComponent);
  fixture.componentRef.setInput('count', 10);
  fixture.detectChanges();
  const pieces = () => (fixture.nativeElement as HTMLElement).querySelectorAll('i').length;
  const fire = (n: number) => {
    fixture.componentRef.setInput('burst', n);
    fixture.detectChanges();
  };
  return { fire, pieces };
}

describe('ConfettiComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lanza papelitos cuando burst aumenta', () => {
    const { fire, pieces } = setup();
    expect(pieces()).toBe(0);
    fire(1);
    expect(pieces()).toBe(10);
  });

  it('no lanza nada si el sistema pide reducir el movimiento', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { fire, pieces } = setup();
    fire(1);
    expect(pieces()).toBe(0);
  });

  it('se limpia solo después de la animación', () => {
    vi.useFakeTimers();
    const { fire, pieces } = setup();
    fire(1);
    vi.advanceTimersByTime(2300);
    TestBed.tick();
    expect(pieces()).toBe(0);
    vi.useRealTimers();
  });
});
