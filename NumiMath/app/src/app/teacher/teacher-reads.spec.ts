import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import {
  HistoryItem,
  HistoryResult,
  ProgressResult,
  StudentsResult,
  TeacherPort,
} from '../core/teacher/teacher.port';
import { TeacherHistoryPage, formatDay } from './teacher-history.page';
import { TeacherStudentPage } from './teacher-student.page';
import { TeacherStudentsPage } from './teacher-students.page';

function configure(teacher: Record<string, unknown>, extra: unknown[] = []) {
  const navigateForward = vi.fn(async () => true);
  const navigateRoot = vi.fn(async () => true);
  const signOut = vi.fn(async () => undefined);
  TestBed.configureTestingModule({
    declarations: [TeacherStudentsPage, TeacherStudentPage, TeacherHistoryPage],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: TeacherPort, useValue: teacher },
      { provide: AuthPort, useValue: { signOut } },
      { provide: NavController, useValue: { navigateForward, navigateRoot } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'perfil-1']]) } } },
      ...(extra as never[]),
    ],
  });
  return { navigateForward, navigateRoot, signOut };
}

async function render<T>(type: Type<T>) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges(); // dispara ngOnInit una sola vez
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  return { fixture, page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('TeacherStudentsPage (D4)', () => {
  const students: StudentsResult = {
    ok: true,
    students: [
      { studentId: 's1', nickname: 'Ana', grade: 2 },
      { studentId: 's2', nickname: 'Beto', grade: 3 },
    ],
  };

  it('lista a los alumnos con solo apodo y curso', async () => {
    configure({ listStudents: async () => students });
    const { el } = await render(TeacherStudentsPage);
    const rows = el.querySelectorAll('[data-testid="student-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Ana');
    expect(rows[0].textContent).toContain('2° básico');
    expect(el.textContent).not.toMatch(/@|tutor@|correo/i);
  });

  it('sin alumnos explica que un tutor debe vincularlo', async () => {
    configure({ listStudents: async () => ({ ok: true, students: [] }) });
    const { el } = await render(TeacherStudentsPage);
    expect(el.querySelector('[data-testid="students-empty"]')?.textContent).toContain('vincularte');
  });

  it('abre el progreso de un alumno', async () => {
    const ctx = configure({ listStudents: async () => students });
    const { page } = await render(TeacherStudentsPage);
    await page.open({ studentId: 's1', nickname: 'Ana', grade: 2 });
    expect(ctx.navigateForward).toHaveBeenCalledWith('/docente/alumnos/s1');
  });

  it('si la cuenta ya no es válida (403) cierra la sesión', async () => {
    const ctx = configure({ listStudents: async () => ({ ok: false, reason: 'forbidden' }) });
    await render(TeacherStudentsPage);
    expect(ctx.signOut).toHaveBeenCalledOnce();
    expect(ctx.navigateRoot).toHaveBeenCalledWith('/docente/login');
  });

  it('un fallo de red lo dice sin cerrar la sesión', async () => {
    const ctx = configure({ listStudents: async () => ({ ok: false, reason: 'network' }) });
    const { el } = await render(TeacherStudentsPage);
    expect(el.querySelector('[data-testid="students-error"]')).not.toBeNull();
    expect(ctx.signOut).not.toHaveBeenCalled();
  });
});

describe('TeacherStudentPage (D5)', () => {
  const progress: ProgressResult = {
    ok: true,
    progress: {
      nickname: 'Ana',
      grade: 2,
      skills: [
        { code: '2-01', label: 'Contar de 2 en 2', module: 'Números', level: 2, blockTotal: 3, blockCorrect: 2, mastered: false },
        { code: '2-02', label: 'Restas', module: 'Números', level: 3, blockTotal: 0, blockCorrect: 0, mastered: true },
      ],
    },
  };

  it('muestra el estado actual por habilidad, sin tiempos ni racha', async () => {
    configure({ getProgress: async () => progress });
    const { el } = await render(TeacherStudentPage);
    const rows = el.querySelectorAll('[data-testid="skill-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Contar de 2 en 2');
    expect(rows[0].querySelector('[data-testid="skill-level"]')?.textContent).toContain('Nivel 2 de 3');
    expect(rows[0].textContent).toContain('2 aciertos de 3 intentos');
    expect(rows[1].querySelector('[data-testid="skill-level"]')?.textContent).toContain('Dominada');
    expect(el.textContent).not.toMatch(/racha|segundos|tiempo típico/i);
  });

  it('un alumno sin habilidades practicadas lo dice', async () => {
    configure({ getProgress: async () => ({ ok: true, progress: { nickname: 'Ana', grade: 2, skills: [] } }) });
    const { el } = await render(TeacherStudentPage);
    expect(el.querySelector('[data-testid="progress-empty"]')).not.toBeNull();
  });

  it('sin vínculo (404) muestra el mismo mensaje y ningún dato', async () => {
    configure({ getProgress: async () => ({ ok: false, reason: 'not_found' }) });
    const { el } = await render(TeacherStudentPage);
    expect(el.querySelector('[data-testid="student-error"]')?.textContent).toContain('No encontramos');
    expect(el.querySelector('[data-testid="skills-list"]')).toBeNull();
    expect(el.querySelector('[data-testid="student-name"]')).toBeNull();
  });

  it('lleva al historial del alumno', async () => {
    const ctx = configure({ getProgress: async () => progress });
    const { page } = await render(TeacherStudentPage);
    await page.openHistory();
    expect(ctx.navigateForward).toHaveBeenCalledWith('/docente/alumnos/perfil-1/historial');
  });

  it('lleva a la evolución del alumno (D6)', async () => {
    const ctx = configure({ getProgress: async () => progress });
    const { page, el } = await render(TeacherStudentPage);
    expect(el.querySelector('[data-testid="open-evolution"]')).not.toBeNull();
    await page.openEvolution();
    expect(ctx.navigateForward).toHaveBeenCalledWith('/docente/alumnos/perfil-1/evolucion');
  });

  it('lleva a las hojas de cálculo del alumno (D8)', async () => {
    const ctx = configure({ getProgress: async () => progress });
    const { page, el } = await render(TeacherStudentPage);
    expect(el.querySelector('[data-testid="open-sheets"]')).not.toBeNull();
    await page.openSheets();
    expect(ctx.navigateForward).toHaveBeenCalledWith('/docente/alumnos/perfil-1/hojas');
  });
});

describe('TeacherHistoryPage (D7)', () => {
  const item = (over: Partial<HistoryItem> = {}): HistoryItem => ({
    label: 'Contar de 2 en 2',
    tutorTask: false,
    exercise: '7 + 5',
    correct: true,
    level: 2,
    day: '2026-11-12',
    ...over,
  });

  it('muestra fecha sin hora, resultado y enunciado de los ejercicios de la app', async () => {
    configure({
      getHistory: async () => ({
        ok: true,
        page: { items: [item(), item({ correct: false, exercise: '9 - 4', day: '2026-11-11' })], hasMore: false, nextOffset: null },
      }),
    });
    const { el } = await render(TeacherHistoryPage);
    const rows = el.querySelectorAll('[data-testid="history-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('12-11-2026');
    expect(rows[0].textContent).toContain('7 + 5');
    expect(rows[1].querySelector('[data-testid="result"]')?.textContent).toContain('Incorrecta');
    expect(el.textContent).not.toMatch(/\d{1,2}:\d{2}|segundos|duración/i);
  });

  it('en las tareas del tutor no hay texto del tutor', async () => {
    configure({
      getHistory: async () => ({
        ok: true,
        page: { items: [item({ tutorTask: true, exercise: null, label: 'Tareas del tutor' })], hasMore: false, nextOffset: null },
      }),
    });
    const { el } = await render(TeacherHistoryPage);
    expect(el.querySelector('[data-testid="tutor-task"]')?.textContent).toContain('Tarea escrita por el tutor');
    expect(el.querySelector('[data-testid="exercise"]')).toBeNull();
  });

  it('pagina con "Cargar más" usando el desplazamiento del servidor', async () => {
    const getHistory = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, page: { items: [item()], hasMore: true, nextOffset: 1 } } as HistoryResult)
      .mockResolvedValueOnce({
        ok: true,
        page: { items: [item({ exercise: '1 + 1' })], hasMore: false, nextOffset: null },
      } as HistoryResult);
    configure({ getHistory });
    const { fixture, page, el } = await render(TeacherHistoryPage);
    expect(el.querySelector('[data-testid="history-more"]')).not.toBeNull();
    await page.more();
    fixture.detectChanges();
    expect(getHistory).toHaveBeenNthCalledWith(1, 'perfil-1', 0);
    expect(getHistory).toHaveBeenNthCalledWith(2, 'perfil-1', 1);
    expect(el.querySelectorAll('[data-testid="history-row"]').length).toBe(2);
    expect(el.querySelector('[data-testid="history-more"]')).toBeNull();
  });

  it('sin ejercicios desde el vínculo lo dice', async () => {
    configure({ getHistory: async () => ({ ok: true, page: { items: [], hasMore: false, nextOffset: null } }) });
    const { el } = await render(TeacherHistoryPage);
    expect(el.querySelector('[data-testid="history-empty"]')).not.toBeNull();
  });

  it('sin vínculo (404) no muestra nada y dice lo mismo que para un alumno inexistente', async () => {
    configure({ getHistory: async () => ({ ok: false, reason: 'not_found' }) });
    const { el } = await render(TeacherHistoryPage);
    expect(el.querySelector('[data-testid="history-error"]')?.textContent).toContain('No encontramos');
    expect(el.querySelector('[data-testid="history-list"]')).toBeNull();
  });

  it('da formato al día sin hora', () => {
    expect(formatDay('2026-11-05')).toBe('05-11-2026');
    expect(formatDay('raro')).toBe('raro');
  });
});
