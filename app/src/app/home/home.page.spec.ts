import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular/lazy';

import { ApiHealthService } from '../core/api/api-health.service';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { HomePage } from './home.page';

function setup(result: 'ok' | 'down') {
  TestBed.configureTestingModule({
    declarations: [HomePage, MascotComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: ApiHealthService, useValue: { check: async () => result } },
    ],
  });
  const fixture: ComponentFixture<HomePage> = TestBed.createComponent(HomePage);
  return fixture;
}

describe('HomePage', () => {
  it('muestra "Servidor conectado" y a la mascota contenta cuando la API responde', async () => {
    const fixture = setup('ok');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Servidor conectado');
    expect(TestBed.inject(MascotPort).state()).toBe('happy');
  });

  it('avisa sin romperse y la mascota se pone triste cuando la API no responde', async () => {
    const fixture = setup('down');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No hay conexión con el servidor');
    expect(TestBed.inject(MascotPort).state()).toBe('sad');
  });
});
