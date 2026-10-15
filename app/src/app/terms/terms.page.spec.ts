import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular/lazy';

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

function setup(verified = true, loadFails = false) {
  const bundle: LegalBundle = {
    terms: doc('terms', verified),
    privacy: doc('privacy', true),
    adult_declaration: doc('adult_declaration', true),
  };
  const accept = vi.fn(async () => ({ ok: true as const }));
  const navigateRoot = vi.fn(async () => true);
  TestBed.configureTestingModule({
    declarations: [TermsPage, MascotComponent, LegalTextComponent],
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
});
