import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AuthPort, AuthResult, AuthUser } from '../core/auth/auth.port';
import { TeacherPort, TeacherProfileResult } from '../core/teacher/teacher.port';
import { TeacherHomePage, UPCOMING } from './teacher-home.page';
import { TeacherLoginPage } from './teacher-login.page';

const TEACHER: AuthUser = { id: 't1', email: 'ana@colegio.test', role: 'teacher' };

describe('TeacherLoginPage (D2)', () => {
  function setup(result: AuthResult, user: AuthUser | null) {
    const state = signal<AuthUser | null>(null);
    const signIn = vi.fn(async () => {
      if (result.ok) state.set(user);
      return result;
    });
    const signOut = vi.fn(async () => state.set(null));
    const navigateRoot = vi.fn(async () => true);
    TestBed.configureTestingModule({
      declarations: [TeacherLoginPage],
      imports: [IonicModule.forRoot(), FormsModule],
      providers: [
        { provide: AuthPort, useValue: { signIn, signOut, user: state } },
        { provide: NavController, useValue: { navigateRoot } },
      ],
    });
    const page = TestBed.createComponent(TeacherLoginPage).componentInstance;
    page.email = ' ana@colegio.test ';
    page.password = 'clave-larga-1';
    return { page, signIn, signOut, navigateRoot };
  }

  it('entra con una cuenta de docente y va a su inicio', async () => {
    const { page, signIn, navigateRoot } = setup({ ok: true }, TEACHER);
    await page.submit();
    expect(signIn).toHaveBeenCalledWith('ana@colegio.test', 'clave-larga-1');
    expect(navigateRoot).toHaveBeenCalledWith('/docente');
    expect(page.password).toBe('');
  });

  it('credenciales incorrectas: informa y permite reintentar', async () => {
    const { page, navigateRoot } = setup({ ok: false, reason: 'invalid_credentials' }, null);
    await page.submit();
    expect(page.error).toBe('El correo o la contraseña no coinciden.');
    expect(navigateRoot).not.toHaveBeenCalled();
    expect(page.busy).toBe(false);
  });

  it.each(['tutor', 'admin'] as const)('una cuenta válida con rol %s recibe el mismo error y se cierra su sesión', async (role) => {
    const { page, signOut, navigateRoot } = setup({ ok: true }, { id: 'x', email: 'x@x.test', role });
    await page.submit();
    expect(page.error).toBe('El correo o la contraseña no coinciden.');
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigateRoot).not.toHaveBeenCalled();
  });

  it('pide correo y contraseña antes de llamar al servidor', async () => {
    const { page, signIn } = setup({ ok: true }, TEACHER);
    page.email = '';
    await page.submit();
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('TeacherLoginPage: enlace de vuelta', () => {
  it('"Volver" lleva al inicio de sesión del tutor y no hay ningún enlace al administrador', () => {
    TestBed.configureTestingModule({
      declarations: [TeacherLoginPage],
      imports: [IonicModule.forRoot(), FormsModule],
      providers: [
        { provide: AuthPort, useValue: { signIn: vi.fn(), signOut: vi.fn(), user: signal(null) } },
        { provide: NavController, useValue: { navigateRoot: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(TeacherLoginPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const back = root.querySelector('[data-testid="teacher-back-link"]') as HTMLElement;
    expect(back.textContent).toContain('Volver');
    expect(back.getAttribute('routerLink')).toBe('/login');
    expect(root.innerHTML).not.toMatch(/\/admin|administrador/i);
  });
});

describe('TeacherHomePage (D3)', () => {
  async function setup(result: TeacherProfileResult) {
    const getProfile = vi.fn(async () => result);
    const signOut = vi.fn(async () => undefined);
    const navigateRoot = vi.fn(async () => true);
    const navigateForward = vi.fn(async () => true);
    TestBed.configureTestingModule({
      declarations: [TeacherHomePage],
      imports: [IonicModule.forRoot()],
      providers: [
        { provide: TeacherPort, useValue: { getProfile } },
        { provide: AuthPort, useValue: { signOut } },
        { provide: NavController, useValue: { navigateRoot, navigateForward } },
      ],
    });
    const fixture = TestBed.createComponent(TeacherHomePage);
    fixture.detectChanges(); // dispara ngOnInit una sola vez
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, page: fixture.componentInstance, signOut, navigateRoot, navigateForward };
  }

  const ok: TeacherProfileResult = { ok: true, profile: { name: 'Ana', linkCode: 'AAAA2345' } };

  it('muestra el código y la explicación de entregárselo al tutor', async () => {
    const { fixture } = await setup(ok);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="teacher-code"]')?.textContent).toContain('AAAA2345');
    expect(el.querySelector('[data-testid="teacher-greeting"]')?.textContent).toContain('Ana');
    expect(el.textContent).toContain('Entrégaselo al tutor');
    expect(el.textContent).toContain('no cambia');
  });

  it('ya no queda nada "Próximamente" (la evolución está activa) y no hay datos de niños', async () => {
    const { fixture } = await setup(ok);
    const el = fixture.nativeElement as HTMLElement;
    expect(UPCOMING).toEqual([]);
    expect(el.textContent).not.toContain('Próximamente');
    expect(el.textContent).not.toContain('Lo que viene');
  });

  it('copia el código al portapapeles', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      const { page } = await setup(ok);
      await page.copy();
      expect(writeText).toHaveBeenCalledWith('AAAA2345');
      expect(page.copied).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ofrece entrar a Mis alumnos, que está activo', async () => {
    const { fixture, page, navigateForward } = await setup(ok);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="open-students"]')).not.toBeNull();
    await page.openStudents();
    expect(navigateForward).toHaveBeenCalledWith('/docente/alumnos');
  });

  it('"Hojas de cálculo" ya no es "Próximamente": está activo y lleva a los alumnos', async () => {
    const { fixture, navigateForward } = await setup(ok);
    const el = fixture.nativeElement as HTMLElement;
    expect(UPCOMING).not.toContain('Hojas de cálculo');
    const button = el.querySelector('[data-testid="open-sheets"]') as HTMLElement;
    expect(button.textContent).toContain('Hojas de cálculo');
    button.click();
    expect(navigateForward).toHaveBeenCalledWith('/docente/alumnos');
  });

  it('si la cuenta ya no existe (403) cierra la sesión y vuelve a la entrada', async () => {
    const { signOut, navigateRoot } = await setup({ ok: false, reason: 'forbidden' });
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigateRoot).toHaveBeenCalledWith('/docente/login');
  });

  it('un fallo de red lo dice sin cerrar la sesión', async () => {
    const { page, signOut } = await setup({ ok: false, reason: 'network' });
    expect(page.error).toContain('No pude cargar');
    expect(signOut).not.toHaveBeenCalled();
  });
});
