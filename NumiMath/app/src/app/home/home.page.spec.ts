import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { ApiHealthService } from '../core/api/api-health.service';
import { AuthPort } from '../core/auth/auth.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { HomePage } from './home.page';

function setup(result: 'ok' | 'down') {
  const signOut = vi.fn(async () => undefined);
  const navigateRoot = vi.fn(async () => true);
  TestBed.configureTestingModule({
    declarations: [HomePage, MascotComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: ApiHealthService, useValue: { check: async () => result } },
      {
        provide: AuthPort,
        useValue: { user: signal({ id: 'u1', email: 'ana@example.test' }), signOut },
      },
      { provide: NavController, useValue: { navigateRoot } },
    ],
  });
  return { fixture: TestBed.createComponent(HomePage), signOut, navigateRoot };
}

describe('HomePage', () => {
  it('muestra "Servidor conectado" y a la mascota contenta cuando la API responde', async () => {
    const { fixture } = setup('ok');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Servidor conectado');
    expect(text).toContain('ana@example.test');
    expect(TestBed.inject(MascotPort).state()).toBe('happy');
  });

  it('avisa sin romperse y la mascota se pone triste cuando la API no responde', async () => {
    const { fixture } = setup('down');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No hay conexión con el servidor');
    expect(TestBed.inject(MascotPort).state()).toBe('sad');
  });

  it('el panel del tutor está en Inicio junto a "¿Quién practica?"', () => {
    const { fixture } = setup('ok');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const panel = el.querySelector('[data-testid="tutor-panel"]');
    expect(panel?.textContent).toContain('Panel del tutor');
    expect(panel?.getAttribute('routerLink') ?? panel?.getAttribute('ng-reflect-router-link')).toBe(
      '/panel',
    );
    expect(el.querySelector('[data-testid="who-practices"]')?.textContent).toContain(
      '¿Quién practica?',
    );
  });

  it('cerrar sesión llama al puerto y vuelve a /login', async () => {
    const { fixture, signOut, navigateRoot } = setup('ok');
    await fixture.componentInstance.signOut();
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigateRoot).toHaveBeenCalledWith('/login');
  });
});
