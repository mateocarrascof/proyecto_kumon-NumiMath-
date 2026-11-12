import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AccountPort } from '../core/account/account.port';
import { DeleteAccountComponent } from '../core/account/delete-account.component';
import { AuthPort } from '../core/auth/auth.port';
import { ConsentPort, LegalBundle } from '../core/consent/consent.port';
import { LegalTextComponent } from '../core/legal/legal-text.component';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { TermsPage } from './terms.page';

function doc(kind: 'terms' | 'privacy' | 'adult_declaration', verified: boolean) {
  return { id: kind, kind, version: `${kind}-1`, text: 'texto', verified };
}

function setup(verified = true, loadFails = false, query: Record<string, string> = {}) {
  const bundle: LegalBundle = {
    terms: doc('terms', verified),
    privacy: doc('privacy', true),
    adult_declaration: doc('adult_declaration', true),
  };
  const accept = vi.fn(async () => ({ ok: true as const }));
  const navigateRoot = vi.fn(async () => true);
  TestBed.configureTestingModule({
    declarations: [TermsPage, MascotComponent, LegalTextComponent, DeleteAccountComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: AuthPort, useValue: { user: signal(null), signOut: vi.fn() } },
      {
        provide: ConsentPort,
        useValue: {
          loadCurrent: async () => {
            if (loadFails) throw new Error('x');
            return bundle;
          },
          accept,
        },
      },
      { provide: NavController, useValue: { navigateRoot } },
      { provide: AccountPort, useValue: { delete: vi.fn() } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(TermsPage);
  return { fixture, page: fixture.componentInstance, accept, navigateRoot };
}

describe('TermsPage', () => {
  it('no acepta si no se marcó la casilla', async () => {
    const { page, accept } = setup();
    await page.ngOnInit();
    await page.accept();
    expect(accept).not.toHaveBeenCalled();
  });

  it('con la casilla marcada guarda y va a /home', async () => {
    const { page, accept, navigateRoot } = setup();
    await page.ngOnInit();
    page.accepted = true;
    await page.accept();
    expect(accept).toHaveBeenCalledOnce();
    expect(navigateRoot).toHaveBeenCalledWith('/home');
  });

  it('un texto no verificado bloquea la aceptación y avisa', async () => {
    const { page, accept } = setup(false);
    await page.ngOnInit();
    page.accepted = true;
    await page.accept();
    expect(accept).not.toHaveBeenCalled();
    expect(page.error).toContain('no coinciden');
  });

  it('si no carga, muestra un mensaje y no se rompe', async () => {
    const { page } = setup(true, true);
    await page.ngOnInit();
    expect(page.error).toContain('No pude cargar');
    expect(page.loading).toBe(false);
  });

  it('sin revocación no muestra ninguna constancia', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    expect(page.revocation).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="revocation-receipt"]')).toBeNull();
  });

  it('tras revocar muestra la constancia con la fecha, el plazo y lo que pasa con los datos', async () => {
    const { page, fixture } = setup(true, false, {
      revocado: '2026-11-11T15:30:00+00:00',
      borrado: '2026-12-11T15:30:00+00:00',
      dias: '30',
    });
    await page.ngOnInit();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="revocation-receipt"]')?.textContent ?? '';
    expect(text).toContain('Consentimiento revocado');
    expect(text).toContain('2026');
    expect(text).toContain('bloqueados');
    expect(text).toContain('se borrarán para siempre a partir del');
    expect(text).toContain('30');
    expect(text).toContain('siguen bloqueados');
  });

  it('una fecha inválida en la dirección no inventa una constancia', async () => {
    const { page } = setup(true, false, { revocado: 'no-es-una-fecha', dias: '30' });
    await page.ngOnInit();
    expect(page.revocation).toBeNull();
  });

  it('un plazo raro en la dirección se ignora', async () => {
    const { page } = setup(true, false, { revocado: '2026-11-11T15:30:00+00:00', dias: '-5' });
    await page.ngOnInit();
    expect(page.revocation?.days).toBeNull();
    expect(page.revocation?.purgeOn).toBeNull();
  });

  it('un plazo absurdo en la dirección no se muestra', async () => {
    const { page } = setup(true, false, { revocado: '2026-11-11T15:30:00+00:00', dias: '1000000' });
    await page.ngOnInit();
    expect(page.revocation?.days).toBeNull();
  });

  it('ofrece eliminar la cuenta aunque no se acepten los términos', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="open-delete-account"]')).not.toBeNull();
  });
});
