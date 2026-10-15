import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { Progress, ProgressPort } from '../core/progress/progress.port';
import { ProgressPage } from './progress.page';

const PROGRESS: Progress = {
  total: 4,
  correct: 3,
  streak: 2,
  byTopic: [{ topic: 'sumas_hasta_20', label: 'Sumas hasta 20', total: 4, correct: 3 }],
  recent: [
    { topic: 'sumas_hasta_20', label: 'Sumas hasta 20', correct: true, answeredAt: '2026-10-15' },
  ],
};

function setup(get: () => Promise<Progress>) {
  TestBed.configureTestingModule({
    declarations: [ProgressPage, MascotComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: ProgressPort, useValue: { get } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'perfil-1' } } } },
    ],
  });
  return TestBed.createComponent(ProgressPage).componentInstance;
}

describe('ProgressPage', () => {
  it('calcula el porcentaje y alegra a la mascota con buen resultado', async () => {
    const page = setup(async () => PROGRESS);
    await page.ngOnInit();
    expect(page.percent).toBe(75);
    expect(TestBed.inject(MascotPort).state()).toBe('happy');
  });

  it('sin intentos, porcentaje 0 y mascota en reposo', async () => {
    const page = setup(async () => ({ ...PROGRESS, total: 0, correct: 0, streak: 0, byTopic: [] }));
    await page.ngOnInit();
    expect(page.percent).toBe(0);
    expect(TestBed.inject(MascotPort).state()).toBe('idle');
  });

  it('si falla la carga, muestra un mensaje y no se rompe', async () => {
    const page = setup(async () => {
      throw new Error('x');
    });
    await page.ngOnInit();
    expect(page.error).toContain('No pude cargar');
    expect(page.loading).toBe(false);
  });
});
