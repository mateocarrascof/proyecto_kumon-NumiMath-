import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AuthPort, AuthResult } from '../core/auth/auth.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { LoginPage } from './login.page';

function setup(result: AuthResult = { ok: true }) {
  const signIn = vi.fn(async () => result);
  const signUp = vi.fn(async () => result);
  const navigateRoot = vi.fn(async () => true);
  TestBed.configureTestingModule({
    declarations: [LoginPage, MascotComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: AuthPort, useValue: { signIn, signUp } },
      { provide: NavController, useValue: { navigateRoot } },
    ],
  });
  const page = TestBed.createComponent(LoginPage).componentInstance;
  return { page, signIn, signUp, navigateRoot, mascot: TestBed.inject(MascotPort) };
}

describe('LoginPage', () => {
  it('rechaza un correo inválido sin llamar al servidor', async () => {
    const { page, signIn, mascot } = setup();
    page.email = 'sin-arroba';
    page.password = 'clave-larga-1';
    await page.submit();
    expect(signIn).not.toHaveBeenCalled();
    expect(page.error).toContain('correo');
    expect(mascot.state()).toBe('sad');
  });

  it('rechaza una contraseña de menos de 8 caracteres', async () => {
    const { page, signIn } = setup();
    page.email = 'a@b.test';
    page.password = 'corta';
    await page.submit();
    expect(signIn).not.toHaveBeenCalled();
    expect(page.error).toContain('8 caracteres');
  });

  it('inicia sesión, limpia la contraseña y va a /home', async () => {
    const { page, signIn, navigateRoot, mascot } = setup();
    page.email = ' a@b.test ';
    page.password = 'clave-larga-1';
    await page.submit();
    expect(signIn).toHaveBeenCalledWith('a@b.test', 'clave-larga-1');
    expect(page.password).toBe('');
    expect(navigateRoot).toHaveBeenCalledWith('/home');
    expect(mascot.state()).toBe('happy');
  });

  it('en modo "crear cuenta" llama a signUp', async () => {
    const { page, signUp } = setup();
    page.toggleMode();
    page.email = 'a@b.test';
    page.password = 'clave-larga-1';
    page.confirm = 'clave-larga-1';
    await page.submit();
    expect(signUp).toHaveBeenCalledOnce();
  });

  it('al crear cuenta, si las contraseñas no coinciden no llama al servidor', async () => {
    const { page, signUp } = setup();
    page.setMode('signup');
    page.email = 'a@b.test';
    page.password = 'clave-larga-1';
    page.confirm = 'clave-larga-2';
    await page.submit();
    expect(signUp).not.toHaveBeenCalled();
    expect(page.error).toBe('Las dos contraseñas no coinciden.');
  });

  it('iniciar sesión no pide repetir la contraseña', async () => {
    const { page, signIn } = setup();
    page.email = 'a@b.test';
    page.password = 'clave-larga-1';
    await page.submit();
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('las dos vistas se ven distintas', () => {
    const { page } = setup();
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="login-title"]')?.textContent).toBe('¡Hola de nuevo!');
    expect(el.querySelector('[data-testid="promises"]')).toBeNull();
    expect(el.querySelector('[data-testid="submit"]')?.textContent).toContain('Entrar');

    fixture.componentInstance.setMode('signup');
    fixture.detectChanges();
    expect(el.querySelector('main')?.getAttribute('data-mode')).toBe('signup');
    expect(el.querySelector('[data-testid="login-title"]')?.textContent).toBe(
      'Crea tu cuenta de adulto',
    );
    expect(el.querySelector('[data-testid="promises"]')?.textContent).toContain('Sin publicidad');
    expect(el.querySelector('[data-testid="submit"]')?.textContent).toContain('Crear mi cuenta');
    expect(el.querySelector('ion-input[name="confirm"]')).not.toBeNull();
    expect(page).toBeTruthy();
  });

  it('cambiar de vista limpia las contraseñas y el error', () => {
    const { page } = setup();
    page.password = 'algo-largo-1';
    page.error = 'x';
    page.setMode('signup');
    expect([page.password, page.confirm, page.error]).toEqual(['', '', '']);
    page.setMode('cualquier-cosa');
    expect(page.mode).toBe('signup');
  });

  it('indica en vivo el largo y si coinciden', () => {
    const { page } = setup();
    page.setMode('signup');
    page.password = 'corta';
    expect(page.longEnough).toBe(false);
    page.password = 'bien-larga';
    page.confirm = 'bien-larga';
    expect(page.longEnough).toBe(true);
    expect(page.matches).toBe(true);
  });

  it('un fallo muestra un mensaje amable y no navega', async () => {
    const { page, navigateRoot, mascot } = setup({ ok: false, reason: 'invalid_credentials' });
    page.email = 'a@b.test';
    page.password = 'clave-larga-1';
    await page.submit();
    expect(page.error).toContain('no coinciden');
    expect(navigateRoot).not.toHaveBeenCalled();
    expect(mascot.state()).toBe('sad');
  });
});
