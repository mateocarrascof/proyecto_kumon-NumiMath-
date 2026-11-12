import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import {
  AdminPort,
  AdminTeacher,
  CreateTeacherResult,
  ListTeachersResult,
} from '../core/admin/admin.port';
import { AuthPort, AuthResult, AuthUser } from '../core/auth/auth.port';
import { AdminLoginPage } from './admin-login.page';
import { AdminTeacherNewPage } from './admin-teacher-new.page';
import { AdminTeachersPage } from './admin-teachers.page';

const ADMIN: AuthUser = { id: 'a1', email: 'admin@x.test', role: 'admin' };

function configure(providers: unknown[]) {
  TestBed.configureTestingModule({
    declarations: [AdminLoginPage, AdminTeachersPage, AdminTeacherNewPage],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: providers as never[],
  });
}

describe('AdminLoginPage (AD1)', () => {
  function setup(result: AuthResult, user: AuthUser | null) {
    const state = signal<AuthUser | null>(null);
    const signIn = vi.fn(async () => {
      if (result.ok) state.set(user);
      return result;
    });
    const signOut = vi.fn(async () => state.set(null));
    const navigateRoot = vi.fn(async () => true);
    configure([
      { provide: AuthPort, useValue: { signIn, signOut, user: state } },
      { provide: NavController, useValue: { navigateRoot } },
    ]);
    const page = TestBed.createComponent(AdminLoginPage).componentInstance;
    page.email = ' admin@x.test ';
    page.password = 'clave-larga-1';
    return { page, signIn, signOut, navigateRoot };
  }

  it('entra con una cuenta de administrador y va a la lista de docentes', async () => {
    const { page, signIn, navigateRoot } = setup({ ok: true }, ADMIN);
    await page.submit();
    expect(signIn).toHaveBeenCalledWith('admin@x.test', 'clave-larga-1');
    expect(navigateRoot).toHaveBeenCalledWith('/admin/docentes');
    expect(page.password).toBe('');
  });

  it('credenciales incorrectas: informa y permite reintentar', async () => {
    const { page, navigateRoot } = setup({ ok: false, reason: 'invalid_credentials' }, null);
    await page.submit();
    expect(page.error).toBe('El correo o la contraseña no coinciden.');
    expect(navigateRoot).not.toHaveBeenCalled();
    expect(page.busy).toBe(false);
  });

  it('una cuenta válida que NO es de administrador recibe el mismo error y se cierra su sesión', async () => {
    const tutor: AuthUser = { id: 't1', email: 't@x.test', role: 'tutor' };
    const { page, signOut, navigateRoot } = setup({ ok: true }, tutor);
    await page.submit();
    expect(page.error).toBe('El correo o la contraseña no coinciden.');
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigateRoot).not.toHaveBeenCalled();
  });

  it('pide correo y contraseña antes de llamar al servidor', async () => {
    const { page, signIn } = setup({ ok: true }, ADMIN);
    page.password = '';
    await page.submit();
    expect(signIn).not.toHaveBeenCalled();
    expect(page.error).toContain('Escribe');
  });

  it('un fallo de red lo dice sin revelar nada más', async () => {
    const { page } = setup({ ok: false, reason: 'network' }, null);
    await page.submit();
    expect(page.error).toContain('conectar');
  });
});

describe('AdminTeachersPage (AD3 mínimo)', () => {
  async function setup(result: ListTeachersResult) {
    const listTeachers = vi.fn(async () => result);
    const navigateForward = vi.fn(async () => true);
    const navigateRoot = vi.fn(async () => true);
    const signOut = vi.fn(async () => undefined);
    configure([
      { provide: AdminPort, useValue: { listTeachers } },
      { provide: AuthPort, useValue: { signOut } },
      { provide: NavController, useValue: { navigateForward, navigateRoot } },
    ]);
    const fixture = TestBed.createComponent(AdminTeachersPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return { fixture, page: fixture.componentInstance, navigateForward, navigateRoot, signOut };
  }

  const teachers: AdminTeacher[] = [
    { id: '1', name: 'ana', email: 'a@x.test', linkCode: 'AAAA2345' },
    { id: '2', name: 'Zoe', email: 'z@x.test', linkCode: 'ZZZZ2345' },
  ];

  it('muestra nombre, correo y código en el orden que entrega el servidor', async () => {
    const { fixture } = await setup({ ok: true, teachers });
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text.indexOf('ana')).toBeLessThan(text.indexOf('Zoe'));
    expect(text).toContain('a@x.test');
    expect(el.querySelectorAll('[data-testid="admin-code"]')[1].textContent).toContain('ZZZZ2345');
    expect(el.querySelector('[data-testid="admin-empty"]')).toBeNull();
  });

  it('sin docentes ofrece crear el primero', async () => {
    const { fixture, page, navigateForward } = await setup({ ok: true, teachers: [] });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="admin-empty"]')).not.toBeNull();
    expect(el.textContent).toContain('Crear el primer docente');
    await page.create();
    expect(navigateForward).toHaveBeenCalledWith('/admin/docentes/nuevo');
  });

  it('si falla la carga lo dice', async () => {
    const { fixture } = await setup({ ok: false, reason: 'network' });
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="admin-list-error"]')).not.toBeNull();
  });

  it('no ofrece editar ni eliminar todavía (AD4 y AD5)', async () => {
    const { fixture } = await setup({ ok: true, teachers });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toMatch(/Editar|Eliminar/);
  });

  it('salir cierra la sesión y vuelve a la entrada del administrador', async () => {
    const { page, signOut, navigateRoot } = await setup({ ok: true, teachers });
    await page.signOut();
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigateRoot).toHaveBeenCalledWith('/admin/login');
  });
});

describe('AdminTeacherNewPage (AD2)', () => {
  function setup(result: CreateTeacherResult) {
    const createTeacher = vi.fn(async () => result);
    const navigateRoot = vi.fn(async () => true);
    configure([
      { provide: AdminPort, useValue: { createTeacher } },
      { provide: NavController, useValue: { navigateRoot } },
    ]);
    const fixture = TestBed.createComponent(AdminTeacherNewPage);
    const page = fixture.componentInstance;
    page.name = ' Profe ';
    page.email = ' p@colegio.test ';
    page.password = 'clave-inicial-1';
    return { fixture, page, createTeacher, navigateRoot };
  }

  const created: CreateTeacherResult = {
    ok: true,
    teacher: {
      id: 'd1',
      name: 'Profe',
      email: 'p@colegio.test',
      linkCode: 'BBBB2345',
      password: 'clave-inicial-1',
    },
  };

  it('crea la cuenta y muestra correo, contraseña y código una vez', async () => {
    const { fixture, page, createTeacher } = setup(created);
    await page.submit();
    fixture.detectChanges();
    expect(createTeacher).toHaveBeenCalledWith({
      name: 'Profe',
      email: 'p@colegio.test',
      password: 'clave-inicial-1',
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="created-email"]')?.textContent).toContain('p@colegio.test');
    expect(el.querySelector('[data-testid="created-password"]')?.textContent).toContain('clave-inicial-1');
    expect(el.querySelector('[data-testid="created-code"]')?.textContent).toContain('BBBB2345');
    expect(el.textContent).toContain('no se podrá volver a ver');
    expect(page.password).toBe(''); // el formulario no conserva la clave
  });

  it('al terminar no conserva la contraseña y vuelve a la lista', async () => {
    const { page, navigateRoot } = setup(created);
    await page.submit();
    await page.done();
    expect(page.created).toBeNull();
    expect(navigateRoot).toHaveBeenCalledWith('/admin/docentes');
  });

  it('correo repetido: lo dice y no muestra credenciales', async () => {
    const { fixture, page } = setup({ ok: false, reason: 'email_taken' });
    await page.submit();
    fixture.detectChanges();
    expect(page.error).toContain('ya tiene una cuenta');
    expect(page.created).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="admin-created"]')).toBeNull();
  });

  it.each([
    ['name', ''],
    ['name', 'x'.repeat(61)],
    ['email', 'sin-arroba'],
    ['password', '1234567'],
    ['password', 'x'.repeat(73)],
  ])('valida %s=%j sin llamar al servidor', async (field, value) => {
    const { page, createTeacher } = setup(created);
    (page as unknown as Record<string, string>)[field] = value;
    await page.submit();
    expect(page.error).not.toBe('');
    expect(createTeacher).not.toHaveBeenCalled();
  });

  it('la contraseña de 8 caracteres es válida', async () => {
    const { page, createTeacher } = setup(created);
    page.password = '12345678';
    await page.submit();
    expect(createTeacher).toHaveBeenCalledOnce();
  });
});
