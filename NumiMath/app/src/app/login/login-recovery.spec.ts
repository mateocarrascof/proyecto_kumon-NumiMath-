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

  it('no muestra aviso con otros valores ni sin parámetro', () => {
    expect(setup(null).componentInstance.notice).toBe('');
    TestBed.resetTestingModule();
    expect(setup('<script>alert(1)</script>').componentInstance.notice).toBe('');
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
});
