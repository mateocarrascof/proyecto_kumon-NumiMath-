import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { ParentalPort, PinError, PinStatus } from '../core/parental/parental.port';
import { PinPage } from './pin.page';

function setup(opts: { status?: PinStatus; query?: Record<string, string> } = {}) {
  const parental = {
    status: vi.fn(async () => opts.status ?? { hasPin: true, lockedUntil: null }),
    verify: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
  };
  const auth = {
    user: signal({ id: 't', email: 'tutor@ejemplo.cl' }),
    signIn: vi.fn(async () => ({ ok: true }) as const),
  };
  const nav = { navigateRoot: vi.fn(async () => true), navigateBack: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    declarations: [PinPage],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: ParentalPort, useValue: parental },
      { provide: AuthPort, useValue: auth },
      { provide: NavController, useValue: nav },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: (k: string) => opts.query?.[k] ?? null } } },
      },
    ],
  });
  const fixture = TestBed.createComponent(PinPage);
  return { page: fixture.componentInstance, fixture, parental, auth, nav };
}

async function type(page: PinPage, pin: string): Promise<void> {
  for (const d of pin) await page.press(d);
}

describe('PinPage', () => {
  it('con PIN pide escribirlo y al acertar entra al panel', async () => {
    const { page, parental, nav } = setup();
    await page.ngOnInit();
    expect(page.mode).toBe('enter');
    await type(page, '2580');
    expect(parental.verify).toHaveBeenCalledWith('2580');
    expect(nav.navigateRoot).toHaveBeenCalledWith('/panel');
  });

  it('borrar quita el último número', async () => {
    const { page, parental } = setup();
    await page.ngOnInit();
    await type(page, '25');
    await page.press('⌫');
    expect(page.digits).toBe('2');
    expect(parental.verify).not.toHaveBeenCalled();
  });

  it('PIN incorrecto muestra los intentos que quedan', async () => {
    const { page, parental, nav } = setup();
    parental.verify.mockRejectedValueOnce(new PinError('wrong', 3));
    await page.ngOnInit();
    await type(page, '1357');
    expect(page.error).toBe('PIN incorrecto. Te quedan 3 intentos.');
    expect(page.digits).toBe('');
    expect(nav.navigateRoot).not.toHaveBeenCalled();
  });

  it('bloqueado sugiere esperar o usar "Olvidé mi PIN"', async () => {
    const { page, parental } = setup();
    parental.verify.mockRejectedValueOnce(new PinError('locked'));
    await page.ngOnInit();
    await type(page, '1357');
    expect(page.error).toContain('Olvidé mi PIN');
  });

  it('sin PIN lo crea pidiéndolo dos veces', async () => {
    const { page, parental, nav } = setup({ status: { hasPin: false, lockedUntil: null } });
    await page.ngOnInit();
    expect(page.mode).toBe('create');
    await type(page, '2580');
    expect(page.mode).toBe('confirm');
    await type(page, '2580');
    expect(parental.set).toHaveBeenCalledWith('2580');
    expect(nav.navigateRoot).toHaveBeenCalledWith('/panel');
  });

  it('si la confirmación no coincide, vuelve a empezar', async () => {
    const { page, parental } = setup({ status: { hasPin: false, lockedUntil: null } });
    await page.ngOnInit();
    await type(page, '2580');
    await type(page, '2581');
    expect(page.mode).toBe('create');
    expect(page.error).toContain('no coinciden');
    expect(parental.set).not.toHaveBeenCalled();
  });

  it('un PIN débil vuelve a "crear" con el mensaje del servidor', async () => {
    const { page, parental } = setup({ status: { hasPin: false, lockedUntil: null } });
    parental.set.mockRejectedValueOnce(new PinError('weak', null, 'Fácil de adivinar.'));
    await page.ngOnInit();
    await type(page, '1234');
    await type(page, '1234');
    expect(page.mode).toBe('create');
    expect(page.error).toBe('Fácil de adivinar.');
  });

  it('"Olvidé mi PIN" pide la contraseña y luego deja crear uno nuevo', async () => {
    const { page, auth, parental } = setup();
    await page.ngOnInit();
    page.forgot();
    expect(page.mode).toBe('forgot');
    page.password = 'mi-contraseña';
    await page.reauth();
    expect(auth.signIn).toHaveBeenCalledWith('tutor@ejemplo.cl', 'mi-contraseña');
    expect(page.password).toBe('');
    expect(page.mode).toBe('create');
    await type(page, '2580');
    await type(page, '2580');
    expect(parental.set).toHaveBeenCalledWith('2580');
  });

  it('una contraseña incorrecta no deja crear PIN', async () => {
    const { page, auth } = setup();
    auth.signIn.mockResolvedValueOnce({ ok: false, reason: 'invalid_credentials' } as never);
    await page.ngOnInit();
    page.forgot();
    page.password = 'mala';
    await page.reauth();
    expect(page.mode).toBe('forgot');
    expect(page.error).toBe('La contraseña no es correcta.');
  });

  it('en modo cambiar va directo a crear el PIN nuevo', async () => {
    const { page, parental } = setup({ query: { cambiar: '1' } });
    await page.ngOnInit();
    expect(page.mode).toBe('create');
    expect(parental.status).not.toHaveBeenCalled();
  });
});
