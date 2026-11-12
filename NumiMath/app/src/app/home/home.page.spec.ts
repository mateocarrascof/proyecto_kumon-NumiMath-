import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { ApiHealthService } from '../core/api/api-health.service';
import { AuthPort } from '../core/auth/auth.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { OFFLINE_MESSAGES, OfflineNoticeComponent } from '../core/offline/offline-notice.component';
import { HomePage } from './home.page';

function setup(result: 'ok' | 'down', panelOpens = true) {
  const signOut = vi.fn(async () => undefined);
  const navigateRoot = vi.fn(async () => true);
  const navigateForward = vi.fn(async () => panelOpens);
  TestBed.configureTestingModule({
    declarations: [HomePage, MascotComponent],
    imports: [IonicModule.forRoot(), OfflineNoticeComponent],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: ApiHealthService, useValue: { check: async () => result } },
      {
        provide: AuthPort,
        useValue: { user: signal({ id: 'u1', email: 'ana@example.test' }), signOut },
      },
      { provide: NavController, useValue: { navigateRoot, navigateForward } },
    ],
  });
  return { fixture: TestBed.createComponent(HomePage), signOut, navigateRoot, navigateForward };
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

  it('el panel del tutor está en Inicio junto a "¿Quién practica?"', async () => {
    const { fixture, navigateForward } = setup('ok');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const panel = el.querySelector('[data-testid="tutor-panel"]') as HTMLElement;
    expect(panel?.textContent).toContain('Panel del tutor');
    await fixture.componentInstance.openPanel();
    expect(navigateForward).toHaveBeenCalledWith('/panel');
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

describe('HomePage sin conexión (CU-A12)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('con conexión se ofrece "Cerrar sesión"', () => {
    const { fixture } = setup('ok');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="sign-out"]')).not.toBeNull();
  });

  it('sin conexión se oculta "Cerrar sesión" (borraría los intentos sin enviar)', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { fixture } = setup('down');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="sign-out"]')).toBeNull();
  });

  it('si "Panel del tutor" no abre por falta de conexión, avisa "Esto necesita internet"', async () => {
    const { fixture } = setup('down', false);
    TestBed.inject(ConnectivityService).reportNetworkFailure();
    fixture.detectChanges();
    await fixture.componentInstance.openPanel();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="offline-needs-internet"]')?.textContent,
    ).toContain(OFFLINE_MESSAGES.needsInternet);
  });

  it('si no abre por otro motivo (con conexión, sin PIN), no muestra ese aviso', async () => {
    const { fixture } = setup('ok', false);
    fixture.detectChanges();
    await fixture.componentInstance.openPanel();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="offline-needs-internet"]')).toBeNull();
  });
});
