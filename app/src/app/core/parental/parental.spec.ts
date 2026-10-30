import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpParentalService } from './http-parental.service';
import { ParentalSession } from './parental-session';
import { parentalGuard } from './parental.guard';
import { PinError } from './parental.port';

const URL = `${environment.apiUrl}/v1/tutor/pin`;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ParentalSession', () => {
  it('guarda el token en memoria hasta poco antes de vencer', () => {
    const session = new ParentalSession();
    let now = 0;
    session.now = () => now;
    expect(session.isUnlocked()).toBe(false);
    expect(session.header()).toEqual({});
    session.start('tok', 600);
    expect(session.header()).toEqual({ 'X-Parental-Token': 'tok' });
    now = (600 - 15) * 1000 - 1;
    expect(session.isUnlocked()).toBe(true);
    now += 1;
    expect(session.isUnlocked()).toBe(false);
  });

  it('end() lo borra', () => {
    const session = new ParentalSession();
    session.start('tok', 600);
    session.end();
    expect(session.token()).toBeNull();
  });
});

describe('parentalGuard', () => {
  function run() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    return TestBed.runInInjectionContext(() =>
      parentalGuard({} as never, { url: '/panel' } as never),
    );
  }

  it('sin PIN verificado manda a /pin', () => {
    const result = run();
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/pin');
  });

  it('con PIN verificado deja pasar', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(ParentalSession).start('tok', 600);
    const result = TestBed.runInInjectionContext(() =>
      parentalGuard({} as never, { url: '/panel' } as never),
    );
    expect(result).toBe(true);
  });
});

describe('HttpParentalService', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthPort, useValue: { accessToken: async () => 'jwt' } },
      ],
    });
    return {
      service: TestBed.inject(HttpParentalService),
      http: TestBed.inject(HttpTestingController),
      session: TestBed.inject(ParentalSession),
    };
  }

  it('lee el estado', async () => {
    const { service, http } = setup();
    const result = service.status();
    await tick();
    http.expectOne(URL).flush({ has_pin: true, locked_until: null });
    expect(await result).toEqual({ hasPin: true, lockedUntil: null });
  });

  it('verificar bien guarda el token en la sesión', async () => {
    const { service, http, session } = setup();
    const result = service.verify('2580');
    await tick();
    const req = http.expectOne(`${URL}/verify`);
    expect(req.request.body).toEqual({ pin: '2580' });
    req.flush({ token: 'tok', expires_in: 600 });
    await result;
    expect(session.token()).toBe('tok');
  });

  it('PIN incorrecto trae los intentos que quedan', async () => {
    const { service, http, session } = setup();
    const result = service.verify('1357').catch((e: PinError) => e);
    await tick();
    http
      .expectOne(`${URL}/verify`)
      .flush(
        { error: { code: 'pin_wrong', message: 'PIN incorrecto.', remaining: '3' } },
        { status: 401, statusText: 'x' },
      );
    const error = (await result) as PinError;
    expect([error.code, error.remaining]).toEqual(['wrong', 3]);
    expect(session.isUnlocked()).toBe(false);
  });

  it('cambiar el PIN manda el token vigente', async () => {
    const { service, http, session } = setup();
    session.start('viejo', 600);
    const result = service.set('1357');
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.headers.get('X-Parental-Token')).toBe('viejo');
    req.flush({ token: 'nuevo', expires_in: 600 });
    await result;
    expect(session.token()).toBe('nuevo');
  });

  it('traduce bloqueo, PIN débil y red', async () => {
    const { service, http } = setup();
    const cases: [number, object, string][] = [
      [423, { error: { code: 'pin_locked' } }, 'locked'],
      [422, { error: { code: 'pin_weak', message: 'Fácil de adivinar.' } }, 'weak'],
      [403, { error: { code: 'pin_reauth_required' } }, 'reauth_required'],
      [503, {}, 'unavailable'],
    ];
    for (const [status, body, code] of cases) {
      const result = service.set('1111').catch((e: PinError) => e.code);
      await tick();
      http.expectOne(URL).flush(body, { status, statusText: 'x' });
      expect(await result).toBe(code);
    }
  });
});
