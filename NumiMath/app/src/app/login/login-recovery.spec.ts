import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { LoginPage } from './login.page';

function setup(aviso: string | null) {
  TestBed.configureTestingModule({
    declarations: [LoginPage, MascotComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: AuthPort, useValue: {} },
      { provide: NavController, useValue: {} },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: () => aviso } } },
      },
    ],
  });
  return TestBed.createComponent(LoginPage);
}

describe('LoginPage: recuperar contraseña', () => {
  it('muestra el aviso al volver de cambiar la contraseña', () => {
    const page = setup('clave-cambiada').componentInstance;
    expect(page.notice).toContain('cambiaste tu contraseña');
  });

  it('muestra el aviso al volver de eliminar la cuenta', () => {
    expect(setup('cuenta-eliminada').componentInstance.notice).toContain('se eliminaron');
  });

  it('no muestra aviso con otros valores ni sin parámetro (ni nada heredado de Object)', () => {
    for (const aviso of [null, '<script>alert(1)</script>', 'constructor', '__proto__', 'toString']) {
      TestBed.resetTestingModule();
      expect(setup(aviso).componentInstance.notice).toBe('');
    }
  });

  it('ofrece el enlace "¿Olvidaste tu contraseña?" solo al iniciar sesión', () => {
    const fixture = setup(null);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="forgot-link"]')).not.toBeNull();
    fixture.componentInstance.setMode('signup');
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="forgot-link"]')).toBeNull();
  });

  it('el inicio de sesión del tutor tiene un enlace discreto "Acceso para docentes" que va a /docente/login', () => {
    const fixture = setup(null);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const link = root.querySelector('[data-testid="teacher-access-link"]') as HTMLElement;
    expect(link.textContent).toContain('Acceso para docentes');
    expect(link.getAttribute('routerLink')).toBe('/docente/login');
    expect(link.getAttribute('color')).toBe('medium'); // discreto: no es el botón principal
    // Y nada que lleve al administrador: ese acceso es solo la dirección web /admin/login.
    expect(root.innerHTML).not.toMatch(/admin/i);
  });

  it('el enlace a docentes solo se ve al iniciar sesión, no al crear cuenta', () => {
    const fixture = setup(null);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="teacher-access-link"]')).not.toBeNull();
    fixture.componentInstance.setMode('signup');
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="teacher-access-link"]')).toBeNull();
  });
});
