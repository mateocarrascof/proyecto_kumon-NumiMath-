import { TestBed } from '@angular/core/testing';

import { MascotComponent } from './mascot.component';
import { MascotState } from './mascot.port';

describe('MascotComponent', () => {
  const states: MascotState[] = ['idle', 'thinking', 'happy', 'sad', 'talking'];

  for (const state of states) {
    it(`dibuja a la mascota en estado ${state} con texto alternativo`, () => {
      TestBed.configureTestingModule({ declarations: [MascotComponent] });
      const fixture = TestBed.createComponent(MascotComponent);
      fixture.componentInstance.state = state;
      fixture.detectChanges();
      const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
      expect(svg?.getAttribute('aria-label')).toContain('Numi');
      expect(svg?.getAttribute('class')).toContain(state);
    });
  }
});

describe('MascotComponent globo de diálogo', () => {
  function render(message: string) {
    TestBed.configureTestingModule({ declarations: [MascotComponent] });
    const fixture = TestBed.createComponent(MascotComponent);
    fixture.componentInstance.message = message;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('muestra el globo cuando hay mensaje', () => {
    const bubble = render('Genial').querySelector('.bubble');
    expect(bubble?.textContent).toContain('Genial');
    // El lector de pantalla puede leerlo.
    expect(bubble?.getAttribute('aria-hidden')).toBeNull();
  });

  it('no muestra el globo sin mensaje', () => {
    expect(render('').querySelector('.bubble')).toBeNull();
  });
});
