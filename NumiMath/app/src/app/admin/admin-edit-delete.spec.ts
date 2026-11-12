import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import {
  AdminPort,
  AdminTeacher,
  DeleteTeacherResult,
  ListTeachersResult,
  UpdateTeacherResult,
} from '../core/admin/admin.port';
import { AdminTeacherDeletePage } from './admin-teacher-delete.page';
import { AdminTeacherEditPage } from './admin-teacher-edit.page';

const ANA: AdminTeacher = { id: 't1', name: 'Ana', email: 'ana@colegio.test', linkCode: 'AAAA2345' };

function configure(admin: Record<string, unknown>) {
  const navigateRoot = vi.fn(async () => true);
  TestBed.configureTestingModule({
    declarations: [AdminTeacherEditPage, AdminTeacherDeletePage],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: AdminPort, useValue: admin },
      { provide: NavController, useValue: { navigateRoot } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 't1']]) } } },
    ],
  });
  return { navigateRoot };
}

const list = (teachers: AdminTeacher[]): ListTeachersResult => ({ ok: true, teachers });

describe('AdminTeacherEditPage (AD4)', () => {
  async function setup(update: UpdateTeacherResult = { ok: true, teacher: ANA, changed: true }) {
    const updateTeacher = vi.fn(async () => update);
    const { navigateRoot } = configure({ listTeachers: async () => list([ANA]), updateTeacher });
    const fixture = TestBed.createComponent(AdminTeacherEditPage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return { fixture, page: fixture.componentInstance, updateTeacher, navigateRoot };
  }

  it('muestra los datos actuales y el código, que no cambia', async () => {
    const { fixture, page } = await setup();
    expect(page.name).toBe('Ana');
    expect(page.email).toBe('ana@colegio.test');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="edit-code"]')?.textContent).toContain('AAAA2345');
  });

  it('sin cambios no hace nada: no llama al servidor ni sale de la pantalla', async () => {
    const { page, updateTeacher, navigateRoot } = await setup();
    await page.submit();
    page.email = ' ANA@colegio.test ';
    await page.submit();
    expect(updateTeacher).not.toHaveBeenCalled();
    expect(navigateRoot).not.toHaveBeenCalled();
    expect(page.notice).toContain('No hay cambios');
  });

  it('envía solo lo que cambió', async () => {
    const { page, updateTeacher, navigateRoot } = await setup();
    page.name = '  Ana María ';
    await page.submit();
    expect(updateTeacher).toHaveBeenCalledWith('t1', { name: 'Ana María' });
    expect(navigateRoot).toHaveBeenCalledWith('/admin/docentes');
  });

  it('cambiar el correo envía solo el correo', async () => {
    const { page, updateTeacher } = await setup();
    page.email = 'nuevo@colegio.test';
    await page.submit();
    expect(updateTeacher).toHaveBeenCalledWith('t1', { email: 'nuevo@colegio.test' });
  });

  it('correo usado por otra cuenta: lo dice y se queda en la pantalla', async () => {
    const { page, navigateRoot } = await setup({ ok: false, reason: 'email_taken' });
    page.email = 'ocupado@colegio.test';
    await page.submit();
    expect(page.error).toContain('ya lo usa otra cuenta');
    expect(navigateRoot).not.toHaveBeenCalled();
    expect(page.busy).toBe(false);
  });

  it.each([
    ['name', ''],
    ['name', 'x'.repeat(61)],
    ['email', 'sin-arroba'],
  ])('valida %s=%j sin llamar al servidor', async (field, value) => {
    const { page, updateTeacher } = await setup();
    (page as unknown as Record<string, string>)[field] = value;
    await page.submit();
    expect(page.error).not.toBe('');
    expect(updateTeacher).not.toHaveBeenCalled();
  });

  it('cancelar vuelve a la lista sin guardar', async () => {
    const { page, updateTeacher, navigateRoot } = await setup();
    page.name = 'Cambiado';
    await page.cancel();
    expect(updateTeacher).not.toHaveBeenCalled();
    expect(navigateRoot).toHaveBeenCalledWith('/admin/docentes');
  });

  it('un docente que ya no existe lo dice', async () => {
    configure({ listTeachers: async () => list([]) });
    const fixture = TestBed.createComponent(AdminTeacherEditPage);
    await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.teacher).toBeNull();
    expect(fixture.componentInstance.error).toContain('ya no existe');
  });
});

describe('AdminTeacherDeletePage (AD5)', () => {
  async function setup(result: DeleteTeacherResult = { ok: true }) {
    const deleteTeacher = vi.fn(async () => result);
    const { navigateRoot } = configure({ listTeachers: async () => list([ANA]), deleteTeacher });
    const fixture = TestBed.createComponent(AdminTeacherDeletePage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return { fixture, page: fixture.componentInstance, deleteTeacher, navigateRoot };
  }

  it('explica qué se borra y qué no se toca', async () => {
    const { fixture } = await setup();
    const text = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="delete-explanation"]')?.textContent ?? '';
    expect(text).toContain('La cuenta del docente');
    expect(text).toContain('Sus vínculos con los tutores');
    expect(text).toContain('Los datos de los niños');
    expect(text).toContain('Las hojas de los niños');
  });

  it('no borra nada hasta confirmar, y cancelar no cambia nada', async () => {
    const { page, deleteTeacher, navigateRoot } = await setup();
    expect(deleteTeacher).not.toHaveBeenCalled();
    await page.cancel();
    expect(deleteTeacher).not.toHaveBeenCalled();
    expect(navigateRoot).toHaveBeenCalledWith('/admin/docentes');
  });

  it('al confirmar elimina y vuelve a la lista', async () => {
    const { page, deleteTeacher, navigateRoot } = await setup();
    await page.confirm();
    expect(deleteTeacher).toHaveBeenCalledWith('t1');
    expect(navigateRoot).toHaveBeenCalledWith('/admin/docentes');
  });

  it('si falla lo dice y no sale de la pantalla', async () => {
    const { page, navigateRoot } = await setup({ ok: false, reason: 'error' });
    await page.confirm();
    expect(page.error).toContain('No pudimos eliminar');
    expect(navigateRoot).not.toHaveBeenCalled();
    expect(page.busy).toBe(false);
  });

  it('un docente que ya no existe no ofrece eliminar', async () => {
    configure({ listTeachers: async () => list([]), deleteTeacher: vi.fn() });
    const fixture = TestBed.createComponent(AdminTeacherDeletePage);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(fixture.componentInstance.teacher).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="admin-delete-confirm"]')).toBeNull();
  });
});
