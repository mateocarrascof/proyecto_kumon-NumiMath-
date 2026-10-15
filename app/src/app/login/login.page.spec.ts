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
    await page.submit();
    expect(signUp).toHaveBeenCalledOnce();
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
