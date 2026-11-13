import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { ConsentPort } from '../core/consent/consent.port';
import { LegalTextComponent } from '../core/legal/legal-text.component';
import { CreateResult, ProfilesPort } from '../core/profiles/profiles.port';
import { ProfileFormComponent, duplicateNicknameMessage } from './profile-form.component';

function setup(result: CreateResult) {
  const create = vi.fn(async () => result);
  TestBed.configureTestingModule({
    declarations: [ProfileFormComponent, LegalTextComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: ProfilesPort, useValue: { create } },
      {
        provide: ConsentPort,
        useValue: {
          loadCurrent: async () => ({
            adult_declaration: { id: 'd', kind: 'adult_declaration', version: 'ad-1', text: 'Declaro…', verified: true },
          }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ProfileFormComponent);
  return { fixture, form: fixture.componentInstance, create };
}

describe('ProfileFormComponent: apodo repetido (ADR 0005)', () => {
  it('dice amablemente que el apodo ya está en ese curso y cómo arreglarlo', async () => {
    const { fixture, form, create } = setup({ ok: false, reason: 'duplicate' });
    await form.ngOnInit();
    form.nickname = 'Juanito';
    form.grade = 1;
    form.declared = true;
    await form.create();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledWith('Juanito', 1);
    const error = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="profile-form-error"]');
    expect(error?.textContent).toContain(
      'Ya tienes un perfil con ese apodo en 1° básico. Elige otro, por ejemplo agrégale un número.',
    );
    expect(form.nickname).toBe('Juanito'); // no se borra lo escrito: solo hay que cambiarlo
  });

  it('el mensaje usa el curso elegido', () => {
    expect(duplicateNicknameMessage(3)).toBe(
      'Ya tienes un perfil con ese apodo en 3° básico. Elige otro, por ejemplo agrégale un número.',
    );
  });
});
