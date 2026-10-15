import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { ConsentPort } from '../core/consent/consent.port';
import { LegalTextComponent } from '../core/legal/legal-text.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { CreateResult, Profile, ProfilesPort } from '../core/profiles/profiles.port';
import { ProfilesPage } from './profiles.page';

function setup(opts: { profiles?: Profile[]; create?: CreateResult; verified?: boolean } = {}) {
  const create = vi.fn(async () => opts.create ?? { ok: false as const, reason: 'unknown' as const });
  const remove = vi.fn(async () => true);
  const list = vi.fn(async () => opts.profiles ?? []);
  TestBed.configureTestingModule({
    declarations: [ProfilesPage, LegalTextComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: ProfilesPort, useValue: { list, create, remove } },
      {
        provide: ConsentPort,
        useValue: {
          loadCurrent: async () => ({
            adult_declaration: {
              id: 'a',
              kind: 'adult_declaration',
              version: 'ad-1',
              text: 'Declaro…',
              verified: opts.verified ?? true,
            },
          }),
        },
      },
      { provide: NavController, useValue: { navigateForward: vi.fn(async () => true) } },
    ],
  });
  return { page: TestBed.createComponent(ProfilesPage).componentInstance, create, remove, list };
}

const p = (n: number): Profile => ({ id: `p${n}`, nickname: `N${n}`, grade: 1, blocked: false });

describe('ProfilesPage', () => {
  it('con 5 perfiles marca el tope', async () => {
    const { page } = setup({ profiles: [1, 2, 3, 4, 5].map(p) });
    await page.ngOnInit();
    expect(page.full).toBe(true);
  });

  it('no crea sin marcar la declaración del adulto', async () => {
    const { page, create } = setup();
    await page.ngOnInit();
    await page.openForm();
    page.nickname = 'Luz';
    await page.create();
    expect(create).not.toHaveBeenCalled();
    expect(page.error).toContain('declaración');
  });

  it('no crea si el texto de la declaración no está verificado', async () => {
    const { page, create } = setup({ verified: false });
    await page.ngOnInit();
    await page.openForm();
    page.declared = true;
    page.nickname = 'Luz';
    await page.create();
    expect(create).not.toHaveBeenCalled();
  });

  it('crea y recarga la lista', async () => {
    const { page, create, list } = setup({ create: { ok: true, profile: p(1) } });
    await page.ngOnInit();
    await page.openForm();
    page.declared = true;
    page.nickname = 'Luz';
    page.grade = 3;
    await page.create();
    expect(create).toHaveBeenCalledWith('Luz', 3);
    expect(list).toHaveBeenCalledTimes(2);
    expect(page.showForm).toBe(false);
  });

  it('borrar pide confirmación antes de llamar al puerto', async () => {
    const { page, remove } = setup({ profiles: [p(1)] });
    await page.ngOnInit();
    page.askDelete('p1');
    expect(remove).not.toHaveBeenCalled();
    await page.confirmDelete();
    expect(remove).toHaveBeenCalledWith('p1');
  });
});
