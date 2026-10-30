import { NgModule } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CoreModule } from '../core.module';
import { GentleTimerComponent, clock } from './gentle-timer.component';

@NgModule({ imports: [CoreModule] })
class HostModule {}

function setup() {
  TestBed.configureTestingModule({ imports: [HostModule] });
  const fixture = TestBed.createComponent(GentleTimerComponent);
  const timer = fixture.componentInstance;
  let now = 0;
  timer.now = () => now;
  return { fixture, timer, advance: (ms: number) => (now += ms) };
}

describe('GentleTimerComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('formatea minutos y segundos', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(42)).toBe('0:42');
    expect(clock(65)).toBe('1:05');
    expect(clock(720)).toBe('12:00');
  });

  it('cuenta hacia arriba (nunca regresiva) y se reinicia con otro ejercicio', () => {
    const { fixture, timer, advance } = setup();
    fixture.componentRef.setInput('resetKey', 'ej-1');
    fixture.detectChanges();
    advance(42_000);
    timer.tick();
    fixture.detectChanges();
    expect(timer.text()).toBe('0:42');
    fixture.componentRef.setInput('resetKey', 'ej-2');
    fixture.detectChanges();
    expect(timer.text()).toBe('0:00');
    timer.ngOnDestroy();
  });

  it('se detiene al responder', () => {
    vi.useFakeTimers();
    try {
      const { fixture, timer, advance } = setup();
      fixture.componentRef.setInput('resetKey', 'ej-1');
      fixture.detectChanges();
      advance(5000);
      vi.advanceTimersByTime(5000);
      expect(timer.text()).toBe('0:05');
      fixture.componentRef.setInput('running', false);
      fixture.detectChanges();
      advance(10_000);
      vi.advanceTimersByTime(10_000);
      expect(timer.text()).toBe('0:05');
      timer.ngOnDestroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tocarlo lo oculta y lo vuelve a mostrar', () => {
    const { fixture, timer } = setup();
    fixture.componentRef.setInput('resetKey', 'ej-1');
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('0:00');
    button.click();
    fixture.detectChanges();
    expect(button.textContent).not.toContain('0:00');
    expect(button.getAttribute('aria-label')).toBe('Mostrar el reloj');
    button.click();
    fixture.detectChanges();
    expect(button.textContent).toContain('0:00');
    timer.ngOnDestroy();
  });
});
