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
