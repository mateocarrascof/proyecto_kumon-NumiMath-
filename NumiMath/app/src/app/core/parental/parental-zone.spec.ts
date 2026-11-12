import { Location } from '@angular/common';
import { SpyLocation, provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom } from 'rxjs';

import { AuthPort, AuthUser } from '../auth/auth.port';
import { ParentalSession } from './parental-session';
import { ParentalZoneWatcher, inTutorZone } from './parental-zone';
import { parentalGuard } from './parental.guard';

@Component({ template: '' })
class BlankComponent {}

/** Documento falso: solo lo que usa el vigilante (estado de visibilidad y su evento). */
function fakeDocument() {
  const target = new EventTarget();
  let state: DocumentVisibilityState = 'visible';
  // defineProperty (no Object.assign, que copiaría el valor y no el getter).
  Object.defineProperty(target, 'visibilityState', { get: () => state });
  const doc = target as unknown as Document;
  const set = (next: DocumentVisibilityState) => {
    state = next;
    target.dispatchEvent(new Event('visibilitychange'));
  };
  return { doc, set };
}

describe('Zona del tutor: el PIN se pide otra vez al salir por cualquier camino', () => {
  async function setup() {
    const user = signal<AuthUser | null>({ id: 'tutor-1', email: 't@example.test' });
    const auth = {
      user,
      signOut: async () => user.set(null),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'home', component: BlankComponent },
          { path: 'login', component: BlankComponent },
          { path: 'practica/:id', component: BlankComponent },
          { path: 'pin', component: BlankComponent },
          { path: 'panel', component: BlankComponent, canActivate: [parentalGuard] },
          { path: 'bloqueada', component: BlankComponent, canActivate: [() => false] },
          { path: '**', redirectTo: 'home' }, // como en app-routing.module.ts
        ]),
        provideLocationMocks(),
        { provide: AuthPort, useValue: auth },
      ],
    });
    const { doc, set } = fakeDocument();
    const stop = TestBed.inject(ParentalZoneWatcher).start(doc);
    TestBed.tick(); // primera lectura del tutor conectado
    const harness = await RouterTestingHarness.create('/home');
    const router = TestBed.inject(Router);
    // Como al arrancar la app: el router escucha "volver" (popstate) de la ubicación.
    router.setUpLocationChangeListener();
    const session = TestBed.inject(ParentalSession);
    const settle = async () => {
      TestBed.tick();
      await harness.fixture.whenStable();
    };

    /** Escribe el PIN (token vigente) y entra al panel desde el inicio. */
    const enterPanel = async () => {
      session.start('tok', 600);
      await harness.navigateByUrl('/panel');
      expect(router.url).toBe('/panel');
      expect(session.isUnlocked()).toBe(true);
    };
    /** Al volver a /panel, el guard manda a /pin. */
    const expectPinAgain = async () => {
      expect(session.isUnlocked()).toBe(false);
      await harness.navigateByUrl('/panel');
      expect(router.url).toBe('/pin');
    };
    return { harness, router, session, auth, set, settle, enterPanel, expectPinAgain, stop };
  }

  it('botón "Inicio" del panel', async () => {
    const { harness, enterPanel, expectPinAgain } = await setup();
    await enterPanel();
    await harness.navigateByUrl('/home');
    await expectPinAgain();
  });

  it('volver (flecha del navegador o botón atrás de Android)', async () => {
    const { router, enterPanel, expectPinAgain } = await setup();
    await enterPanel();
    const done = firstValueFrom(router.events.pipe(filter((e) => e instanceof NavigationEnd)));
    // Lo que hace el navegador al volver: un `popstate` hacia la pantalla anterior.
    (TestBed.inject(Location) as SpyLocation).simulateUrlPop('/home');
    await done;
    expect(router.url).toBe('/home');
    await expectPinAgain();
  });

  it('cambiar de perfil (desde el inicio, ir a la pantalla de un niño)', async () => {
    const { harness, enterPanel, expectPinAgain } = await setup();
    await enterPanel();
    await harness.navigateByUrl('/home');
    await harness.navigateByUrl('/practica/p1');
    await expectPinAgain();
  });

  it('cerrar sesión', async () => {
    const { harness, auth, settle, enterPanel, expectPinAgain } = await setup();
    await enterPanel();
    await auth.signOut();
    await settle();
    await harness.navigateByUrl('/login');
    await expectPinAgain();
  });

  it('cerrar sesión o cambiar de tutor borra el token aunque no haya navegación', async () => {
    const { session, auth, settle, enterPanel } = await setup();
    await enterPanel();
    auth.user.set({ id: 'tutor-2', email: 'otro@example.test' });
    await settle();
    expect(session.isUnlocked()).toBe(false);
    await enterPanel();
    await auth.signOut();
    await settle();
    expect(session.isUnlocked()).toBe(false);
  });

  it('el mismo tutor con un objeto de sesión nuevo (renovación del token) NO borra el token', async () => {
    const { session, auth, settle, enterPanel } = await setup();
    await enterPanel();
    auth.user.set({ id: 'tutor-1', email: 't@example.test' }); // objeto nuevo, mismo id
    await settle();
    expect(session.isUnlocked()).toBe(true);
  });

  it('pasar a segundo plano: borra el token y, al volver, lleva del panel a /pin', async () => {
    const { router, session, set, settle, enterPanel, expectPinAgain } = await setup();
    await enterPanel();
    set('hidden');
    expect(session.isUnlocked()).toBe(false);
    set('visible');
    await settle();
    expect(router.url).toBe('/pin'); // los datos del niño no quedan a la vista
    await expectPinAgain();
  });

  it('volver a primer plano fuera del panel no navega', async () => {
    const { harness, router, set, settle } = await setup();
    await harness.navigateByUrl('/home');
    set('hidden');
    set('visible');
    await settle();
    expect(router.url).toBe('/home');
  });

  it('dentro de la zona no se borra: cambiar el PIN y volver al panel', async () => {
    const { harness, router, session, enterPanel } = await setup();
    await enterPanel();
    await harness.navigateByUrl('/pin?cambiar=1');
    expect(session.isUnlocked()).toBe(true); // el servidor exige el token para cambiar el PIN
    await harness.navigateByUrl('/panel');
    expect(router.url).toBe('/panel');
  });

  it('se borra al iniciar la navegación hacia fuera, aunque después se cancele', async () => {
    const { router, session, enterPanel } = await setup();
    await enterPanel();
    expect(await router.navigateByUrl('/bloqueada')).toBe(false); // un guard la cancela
    expect(router.url).toBe('/panel');
    expect(session.isUnlocked()).toBe(false);
  });

  it('una URL de la zona que termina redirigida fuera (/panel/x → /home) también borra el token', async () => {
    const { harness, router, session, enterPanel, expectPinAgain } = await setup();
    await enterPanel();
    await harness.navigateByUrl('/panel/x');
    expect(router.url).toBe('/home');
    expect(session.isUnlocked()).toBe(false);
    await expectPinAgain();
  });

  it('dejar de vigilar', async () => {
    const { harness, session, enterPanel, stop } = await setup();
    await enterPanel();
    stop();
    await harness.navigateByUrl('/home');
    expect(session.isUnlocked()).toBe(true);
  });
});

describe('inTutorZone', () => {
  it('el panel y el PIN son zona; lo demás no', () => {
    expect(inTutorZone('/panel')).toBe(true);
    expect(inTutorZone('/pin?cambiar=1')).toBe(true);
    expect(inTutorZone('/pin')).toBe(true);
    expect(inTutorZone('/home')).toBe(false);
    expect(inTutorZone('/practica/p1')).toBe(false);
    expect(inTutorZone('/login')).toBe(false);
    expect(inTutorZone('/panelito')).toBe(false);
    expect(inTutorZone('/pines')).toBe(false);
  });
});
