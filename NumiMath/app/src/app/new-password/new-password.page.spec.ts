import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AuthPort, AuthResult, RecoveryLink, RecoveryStart } from '../core/auth/auth.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { NewPasswordPage } from './new-password.page';

const QUERY = '?token_hash=abcdefgh12345678&type=recovery';

function setup(start: RecoveryStart = 'ready', result: AuthResult = { ok: true }) {
  const beginRecovery = vi.fn(async (_link: RecoveryLink) => start);
  const completePasswordReset = vi.fn(async (_password: string) => result);
  const navigateRoot = vi.fn(async () => true);
  const cancelRecovery = vi.fn(async () => undefined);
  TestBed.configureTestingModule({
    declarations: [NewPasswordPage, MascotComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      {
        provide: AuthPort,
        useValue: { beginRecovery, completePasswordReset, cancelRecovery },
      },
      { provide: NavController, useValue: { navigateRoot } },
    ],
  });
  return {
    page: TestBed.createComponent(NewPasswordPage).componentInstance,
    beginRecovery,
    completePasswordReset,
    navigateRoot,
    cancelRecovery,
  };
}

/** Abre la página como lo haría el enlace y canjea el código (el botón). */
async function openReady(ctx: ReturnType<typeof setup>) {
  ctx.page.ngOnInit();
  await ctx.page.confirmLink();
}

describe('NewPasswordPage', () => {
  beforeEach(() => window.history.replaceState(null, '', `/nueva-clave${QUERY}`));
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('al abrirse borra el código de la barra de direcciones y NO lo canjea todavía', () => {
    const { page, beginRecovery } = setup();
    page.ngOnInit();
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/nueva-clave');
    expect(page.state).toBe('confirm');
    expect(beginRecovery).not.toHaveBeenCalled(); // un escáner que solo abre el enlace no lo gasta
  });

  it('el código se canjea solo al pulsar el botón y con los datos del enlace', async () => {
    const ctx = setup();
    await openReady(ctx);
    expect(ctx.beginRecovery).toHaveBeenCalledExactlyOnceWith({
      tokenHash: 'abcdefgh12345678',
      type: 'recovery',
    });
    expect(ctx.page.state).toBe('ready');
  });

  it('pulsar dos veces el botón no canjea el código dos veces', async () => {
    const ctx = setup();
    ctx.page.ngOnInit();
    await Promise.all([ctx.page.confirmLink(), ctx.page.confirmLink()]);
    await ctx.page.confirmLink();
    expect(ctx.beginRecovery).toHaveBeenCalledTimes(1);
  });

  it('una página sin código (o con la URL a medias) muestra el enlace inválido', () => {
    window.history.replaceState(null, '', '/nueva-clave?type=recovery');
    const { page, beginRecovery } = setup();
    page.ngOnInit();
    expect(page.state).toBe('invalid');
    expect(beginRecovery).not.toHaveBeenCalled();
  });

  it('un enlace vencido o ya usado (el servidor lo rechaza) muestra el aviso y no deja escribir la clave', async () => {
    const ctx = setup('invalid');
    await openReady(ctx);
    expect(ctx.page.state).toBe('invalid');
    ctx.page.password = 'Clave-nueva-456';
    ctx.page.confirm = 'Clave-nueva-456';
    await ctx.page.submit();
    expect(ctx.completePasswordReset).not.toHaveBeenCalled();
  });

  it('si se sale de la pantalla sin cambiar la clave, se cierra la sesión de recuperación', () => {
    const { page, cancelRecovery } = setup();
    page.ngOnDestroy();
    expect(cancelRecovery).toHaveBeenCalledOnce();
  });

  it('rechaza una contraseña corta con la misma regla que el registro', async () => {
    const ctx = setup();
    await openReady(ctx);
    ctx.page.password = 'corta';
    ctx.page.confirm = 'corta';
    await ctx.page.submit();
    expect(ctx.page.error).toContain('al menos 8 caracteres');
    expect(ctx.completePasswordReset).not.toHaveBeenCalled();
  });

  it('rechaza si las dos contraseñas no coinciden', async () => {
    const ctx = setup();
    await openReady(ctx);
    ctx.page.password = 'Clave-nueva-456';
    ctx.page.confirm = 'Clave-nueva-457';
    await ctx.page.submit();
    expect(ctx.page.error).toContain('no coinciden');
    expect(ctx.completePasswordReset).not.toHaveBeenCalled();
  });

  it('guarda la nueva contraseña, la borra de la pantalla y vuelve al login con un aviso', async () => {
    const ctx = setup();
    await openReady(ctx);
    ctx.page.password = 'Clave-nueva-456';
    ctx.page.confirm = 'Clave-nueva-456';
    await ctx.page.submit();
    expect(ctx.completePasswordReset).toHaveBeenCalledExactlyOnceWith('Clave-nueva-456');
    expect(ctx.page.password).toBe('');
    expect(ctx.page.confirm).toBe('');
    expect(ctx.navigateRoot).toHaveBeenCalledWith('/login', {
      queryParams: { aviso: 'clave-cambiada' },
    });
  });

  it('si el servidor la rechaza por débil, avisa y se queda en la pantalla', async () => {
    const ctx = setup('ready', { ok: false, reason: 'weak_password' });
    await openReady(ctx);
    ctx.page.password = 'Clave-nueva-456';
    ctx.page.confirm = 'Clave-nueva-456';
    await ctx.page.submit();
    expect(ctx.page.error).toContain('muy débil');
    expect(ctx.page.state).toBe('ready');
    expect(ctx.navigateRoot).not.toHaveBeenCalled();
  });

  it('un error inesperado al guardar permite reintentar (no se declara vencido el enlace)', async () => {
    const ctx = setup('ready', { ok: false, reason: 'unknown' });
    await openReady(ctx);
    ctx.page.password = 'Clave-nueva-456';
    ctx.page.confirm = 'Clave-nueva-456';
    await ctx.page.submit();
    expect(ctx.page.state).toBe('ready');
    expect(ctx.page.error).toContain('Inténtalo de nuevo');
  });

  it('si la sesión de recuperación venció justo al guardar, pasa al aviso de enlace inválido', async () => {
    const ctx = setup('ready', { ok: false, reason: 'link_expired' });
    await openReady(ctx);
    ctx.page.password = 'Clave-nueva-456';
    ctx.page.confirm = 'Clave-nueva-456';
    await ctx.page.submit();
    expect(ctx.page.state).toBe('invalid');
    expect(ctx.page.error).toContain('Pide uno nuevo');
  });
});
