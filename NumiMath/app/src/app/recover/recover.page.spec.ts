import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { RECOVER_COOLDOWN_SECONDS, RecoverPage } from './recover.page';

function setup(requestPasswordReset = vi.fn(async (_email: string) => undefined)) {
  TestBed.configureTestingModule({
    declarations: [RecoverPage, MascotComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: AuthPort, useValue: { requestPasswordReset } },
    ],
  });
  return { page: TestBed.createComponent(RecoverPage).componentInstance, requestPasswordReset };
}

describe('RecoverPage', () => {
  afterEach(() => vi.useRealTimers());

  it('rechaza un correo sin arroba sin llamar al servidor', async () => {
    const { page, requestPasswordReset } = setup();
    page.email = 'sin-arroba';
    await page.submit();
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(page.error).toContain('correo válido');
    expect(page.sent).toBe(false);
  });

  it('tras pedirlo, la pantalla pasa a "enviado" sin error (la neutralidad la garantiza el puerto)', async () => {
    const { page } = setup();
    page.email = 'cualquiera@example.test';
    await page.submit();
    expect(page.sent).toBe(true);
    expect(page.error).toBe('');
  });

  it('recorta el correo y lo envía una sola vez', async () => {
    const { page, requestPasswordReset } = setup();
    page.email = '  ana@example.test ';
    await page.submit();
    expect(requestPasswordReset).toHaveBeenCalledExactlyOnceWith('ana@example.test');
  });

  it('impone una pausa entre pedidos y luego deja pedir otro', async () => {
    vi.useFakeTimers();
    const { page, requestPasswordReset } = setup();
    page.email = 'ana@example.test';
    await page.submit();
    expect(page.cooldown).toBe(RECOVER_COOLDOWN_SECONDS);

    await page.submit(); // durante la pausa: ignorado
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RECOVER_COOLDOWN_SECONDS * 1000);
    expect(page.cooldown).toBe(0);
    await page.submit();
    expect(requestPasswordReset).toHaveBeenCalledTimes(2);
    page.ngOnDestroy();
  });
});
