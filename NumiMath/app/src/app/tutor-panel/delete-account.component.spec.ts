import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AccountPort, DeleteAccountResult } from '../core/account/account.port';
import { AuthPort, AuthResult } from '../core/auth/auth.port';
import { ParentalSession } from '../core/parental/parental-session';
import { DeleteAccountComponent } from './delete-account.component';

function setup(options: { login?: AuthResult; result?: DeleteAccountResult } = {}) {
  const signIn = vi.fn(async (_email: string, _password: string) => options.login ?? { ok: true as const });
  const del = vi.fn(async (_confirm: string) => options.result ?? ('ok' as DeleteAccountResult));
  const signOut = vi.fn(async () => undefined);
  const navigateRoot = vi.fn(async () => true);
  TestBed.configureTestingModule({
    declarations: [DeleteAccountComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: AccountPort, useValue: { delete: del } },
      {
        provide: AuthPort,
        useValue: { signIn, signOut, user: signal({ id: 'u1', email: 'ana@example.test' }) },
      },
      { provide: NavController, useValue: { navigateRoot } },
    ],
  });
  const fixture = TestBed.createComponent(DeleteAccountComponent);
  return { fixture, c: fixture.componentInstance, signIn, del, signOut, navigateRoot };
}

function fill(c: DeleteAccountComponent, word = 'ELIMINAR', password = 'Clave-inicial-123') {
  c.open = true;
  c.onWord(word);
  c.onPassword(password);
}

describe('DeleteAccountComponent', () => {
  it('empieza cerrado y explica qué se borra y qué se conserva al abrirlo', () => {
    const { fixture, c } = setup();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="delete-account-form"]')).toBeNull();
    c.toggle();
    fixture.detectChanges();
    const text = root.textContent ?? '';
    expect(text).toContain('Se borra para siempre');
    expect(text).toContain('Se conserva');
    expect(text).toContain('no se puede deshacer');
  });

  it('pide la contraseña de la cuenta, no el PIN', () => {
    const { fixture, c } = setup();
    c.toggle();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="delete-account-password"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="delete-account-pin"]')).toBeNull();
  });

  it('acepta ELIMINAR en cualquier mayúscula/minúscula (teléfonos) y exige la contraseña', () => {
    const { c } = setup();
    for (const [word, password, ready] of [
      ['ELIMINAR', 'x', true],
      ['eliminar', 'x', true],
      ['Eliminar', 'x', true],
      ['ELIMINAR ', 'x', true],
      ['ELIMINA', 'x', false],
      ['', 'x', false],
      ['ELIMINAR', '', false],
    ] as const) {
      fill(c, word, password);
      expect(c.ready).toBe(ready);
    }
  });

  it('con la confirmación completa: vuelve a entrar con la contraseña, borra con la palabra exacta, cierra sesión y va al login con aviso', async () => {
    const { c, signIn, del, signOut, navigateRoot } = setup();
    fill(c, 'eliminar');
    await c.confirm();
    expect(signIn).toHaveBeenCalledExactlyOnceWith('ana@example.test', 'Clave-inicial-123');
    expect(del).toHaveBeenCalledExactlyOnceWith('ELIMINAR');
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigateRoot).toHaveBeenCalledWith('/login', {
      queryParams: { aviso: 'cuenta-eliminada' },
    });
  });

  it('el token del PIN deja de valer al eliminar la cuenta', async () => {
    const { c } = setup();
    const session = TestBed.inject(ParentalSession);
    session.start('token', 600);
    fill(c);
    await c.confirm();
    expect(session.isUnlocked()).toBe(false);
  });

  it('la contraseña se borra de la pantalla en cuanto se usa', async () => {
    const { c } = setup();
    fill(c);
    await c.confirm();
    expect(c.password).toBe('');
  });

  it('una contraseña incorrecta NO llama a la API y no cierra la sesión', async () => {
    const { c, del, signOut } = setup({ login: { ok: false, reason: 'invalid_credentials' } });
    fill(c);
    await c.confirm();
    expect(del).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(c.error).toBe('La contraseña no coincide.');
    expect(c.busy).toBe(false);
  });

  it('si no se puede verificar la contraseña (red) tampoco llama a la API', async () => {
    const { c, del } = setup({ login: { ok: false, reason: 'network' } });
    fill(c);
    await c.confirm();
    expect(del).not.toHaveBeenCalled();
    expect(c.error).toContain('No pude verificar');
  });

  it('si el servidor falla, avisa y NO cierra la sesión ni va al login', async () => {
    const { c, signOut, navigateRoot } = setup({ result: 'error' });
    fill(c);
    await c.confirm();
    expect(c.error).toContain('No pudimos confirmar');
    expect(signOut).not.toHaveBeenCalled();
    expect(navigateRoot).not.toHaveBeenCalled();
  });

  it('sin conexión, con la sesión vencida y con palabra rechazada muestran su propio mensaje', async () => {
    for (const [result, text] of [
      ['network', 'No pude confirmar'],
      ['pin', 'Tu sesión venció'],
      ['confirm', 'Escribe ELIMINAR'],
    ] as const) {
      TestBed.resetTestingModule();
      const { c } = setup({ result });
      fill(c);
      await c.confirm();
      expect(c.error).toContain(text);
    }
  });

  it('si ya borró pero cerrar la sesión local falla, igual termina y va al login', async () => {
    const { c, signOut, navigateRoot } = setup();
    signOut.mockRejectedValueOnce(new Error('Auth ya no conoce la sesión'));
    fill(c);
    await c.confirm();
    expect(navigateRoot).toHaveBeenCalled();
  });

  it('no hace nada si falta la confirmación', async () => {
    const { c, signIn, del } = setup();
    fill(c, 'ELIMINAR', '');
    await c.confirm();
    expect(signIn).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('cancelar limpia la palabra, la contraseña y el error', () => {
    const { c } = setup();
    fill(c);
    c.error = 'algo';
    c.toggle();
    expect([c.open, c.word, c.password, c.error]).toEqual([false, '', '', '']);
  });
});
