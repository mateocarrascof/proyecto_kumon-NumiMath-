import { TestBed } from '@angular/core/testing';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { Assignment, AssignmentsPort, TutorError } from '../core/assignments/assignments.port';
import { WeeklyChartComponent } from '../core/charts/weekly-chart.component';
import { ConsentPort } from '../core/consent/consent.port';
import { ParentalSession } from '../core/parental/parental-session';
import { ParentalPort, PinError } from '../core/parental/parental.port';
import { Profile, ProfilesPort } from '../core/profiles/profiles.port';
import { Report, ReportPort } from '../core/report/report.port';
import { AccountPort } from '../core/account/account.port';
import { AuthPort } from '../core/auth/auth.port';
import { DeleteAccountComponent } from './delete-account.component';
import { ProfileFormComponent } from './profile-form.component';
import { MAX_PENDING, TutorPanelPage } from './tutor-panel.page';

const REPORT: Report = {
  total: 20,
  correct: 15,
  percent: 75,
  medianSeconds: 80,
  dailyStreak: 3,
  practiceDaysLast7: 2,
  weeks: [{ start: '2026-10-20', total: 20, correct: 15 }],
  byTopic: [
    { topic: 'sumas', label: 'Sumas', total: 20, correct: 15, percent: 75, medianSeconds: 35 },
    { topic: 'restas', label: 'Restas', total: 2, correct: 1, percent: 50, medianSeconds: null },
  ],
  feedback: [
    { kind: 'strength', text: 'Su punto fuerte es Sumas (75 % de aciertos).' },
    { kind: 'habit', text: 'Practicó 2 días esta semana: unos 10 minutos diarios ayudan mucho.' },
  ],
};

function task(id: string, status: Assignment['status'] = 'pending'): Assignment {
  return { id, text: `${id} + 1 = ?`, answer: 2, status, createdAt: '', answeredAt: null };
}

const KIDS: Profile[] = [
  { id: 'perfil-1', nickname: 'Ana', grade: 2, blocked: false },
  { id: 'perfil-2', nickname: 'Beto', grade: 3, blocked: false },
];

function setup(
  opts: { tasks?: Assignment[]; report?: () => Promise<Report>; kids?: Profile[] } = {},
) {
  let tasks = opts.tasks ?? [];
  const nav = { navigateRoot: vi.fn(async () => true), navigateForward: vi.fn(async () => true) };
  let kids = [...(opts.kids ?? KIDS)];
  const profiles = {
    list: vi.fn(async () => kids),
    create: vi.fn(),
    remove: vi.fn(async (id: string) => {
      kids = kids.filter((k) => k.id !== id);
      return 'ok' as const;
    }),
  };
  const parental = { status: vi.fn(), verify: vi.fn(async () => undefined), set: vi.fn() };
  const assignments = {
    all: vi.fn(async () => tasks),
    create: vi.fn(async () => {
      tasks = [...tasks, task('nueva')];
    }),
    remove: vi.fn(async (_s: string, id: string) => {
      tasks = tasks.filter((t) => t.id !== id);
    }),
    forKid: vi.fn(),
    answer: vi.fn(),
  };
  const reports = { get: vi.fn(opts.report ?? (async () => REPORT)) };
  TestBed.configureTestingModule({
    declarations: [TutorPanelPage, WeeklyChartComponent, ProfileFormComponent, DeleteAccountComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: AssignmentsPort, useValue: assignments },
      { provide: ReportPort, useValue: reports },
      { provide: ProfilesPort, useValue: profiles },
      { provide: ParentalPort, useValue: parental },
      { provide: AccountPort, useValue: { delete: vi.fn(async () => 'ok') } },
      { provide: AuthPort, useValue: { signOut: vi.fn(async () => undefined) } },
      { provide: ConsentPort, useValue: { loadCurrent: vi.fn(async () => ({})) } },
      { provide: NavController, useValue: nav },
    ],
  });
  const session = TestBed.inject(ParentalSession);
  session.start('token-del-pin', 600);
  const fixture = TestBed.createComponent(TutorPanelPage);
  return { page: fixture.componentInstance, fixture, assignments, reports, nav, session, profiles, parental };
}

describe('TutorPanelPage', () => {
  it('muestra resumen, feedback, gráfico y temas', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="stat-total"]')?.textContent).toBe('20');
    expect(el.querySelector('[data-testid="stat-percent"]')?.textContent).toBe('75%');
    expect(el.textContent).toContain('Su punto fuerte es Sumas');
    expect(el.textContent).toContain('10 minutos diarios');
    expect(el.querySelector('app-weekly-chart svg')).not.toBeNull();
  });

  it('crea una tarea y la vuelve a listar', async () => {
    const { page, assignments } = setup();
    await page.ngOnInit();
    expect(page.canSave).toBe(false);
    page.onText('  Tienes 3 y te dan 4. ¿Cuántos tienes?  ');
    page.onAnswer('7a');
    expect(page.answer).toBe('7');
    await page.save();
    expect(assignments.create).toHaveBeenCalledWith(
      'perfil-1',
      'Tienes 3 y te dan 4. ¿Cuántos tienes?',
      7,
    );
    expect(page.tasks).toHaveLength(1);
    expect(page.text).toBe('');
    expect(page.formOk).toContain('Tarea guardada');
  });

  it('muestra el mensaje del filtro sin perder lo escrito', async () => {
    const { page, assignments } = setup();
    assignments.create.mockRejectedValueOnce(
      new TutorError('rejected', 'Quita datos personales, como nombres reales.'),
    );
    await page.ngOnInit();
    page.onText('Juan Pérez tiene 3 manzanas');
    page.onAnswer('3');
    await page.save();
    expect(page.formError).toBe('Quita datos personales, como nombres reales.');
    expect(page.text).toBe('Juan Pérez tiene 3 manzanas');
  });

  it('el enunciado se corta en 200 caracteres', () => {
    const { page } = setup();
    page.onText('x'.repeat(250));
    expect(page.text).toHaveLength(200);
  });

  it('con 20 pendientes no deja guardar más', async () => {
    const { page } = setup({ tasks: Array.from({ length: MAX_PENDING }, (_, i) => task(`t${i}`)) });
    await page.ngOnInit();
    page.onText('1 + 1');
    page.onAnswer('2');
    expect(page.full).toBe(true);
    expect(page.canSave).toBe(false);
  });

  it('borra solo tareas pendientes', async () => {
    const { page, assignments } = setup({ tasks: [task('a'), task('b', 'correct')] });
    await page.ngOnInit();
    await page.remove(page.tasks[1]);
    expect(assignments.remove).not.toHaveBeenCalled();
    await page.remove(page.tasks[0]);
    expect(assignments.remove).toHaveBeenCalledWith('perfil-1', 'a');
    expect(page.tasks.map((t) => t.id)).toEqual(['b']);
  });

  it('si el informe falla, las tareas siguen disponibles', async () => {
    const { page } = setup({
      tasks: [task('a')],
      report: async () => {
        throw new TutorError('network');
      },
    });
    await page.ngOnInit();
    expect(page.report).toBeNull();
    expect(page.reportError).toBe('No pude conectar con el servidor.');
    expect(page.tasks).toHaveLength(1);
  });

  it('muestra una pestaña por niño y empieza por el primero', async () => {
    const { page, fixture, reports } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="kid-Ana"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="kid-Beto"]')).not.toBeNull();
    expect(page.studentId).toBe('perfil-1');
    expect(reports.get).toHaveBeenCalledWith('perfil-1');
  });

  it('al cambiar de niño recarga informe y tareas', async () => {
    const { page, reports, assignments } = setup();
    await page.ngOnInit();
    await page.select('perfil-2');
    expect(page.studentId).toBe('perfil-2');
    expect(reports.get).toHaveBeenLastCalledWith('perfil-2');
    expect(assignments.all).toHaveBeenLastCalledWith('perfil-2');
    // Un id que no es de sus perfiles se ignora.
    await page.select('ajeno');
    expect(page.studentId).toBe('perfil-2');
  });

  it('sin perfiles invita a crear uno', async () => {
    const { page, fixture } = setup({ kids: [] });
    await page.ngOnInit();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Todavía no hay perfiles');
  });

  it('si el PIN venció, borra el token y vuelve a pedirlo', async () => {
    const { page, nav, session } = setup({
      report: async () => {
        throw new TutorError('parental_required');
      },
    });
    await page.ngOnInit();
    expect(session.isUnlocked()).toBe(false);
    expect(nav.navigateRoot).toHaveBeenCalledWith('/pin');
  });

  it('salir del panel borra el token', async () => {
    const { page, nav, session } = setup();
    await page.ngOnInit();
    await page.exit();
    expect(session.isUnlocked()).toBe(false);
    expect(nav.navigateRoot).toHaveBeenCalledWith('/home');
  });

  it('cambiar PIN abre la pantalla del PIN en modo cambiar', async () => {
    const { page, nav } = setup();
    await page.changePin();
    expect(nav.navigateForward).toHaveBeenCalledWith('/pin', { queryParams: { cambiar: '1' } });
  });

  it('lista los perfiles con "Eliminar" y "Crear perfil"', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="admin-Ana"]')?.textContent).toContain('Eliminar');
    expect(el.querySelector('[data-testid="new-profile"]')).not.toBeNull();
  });

  it('eliminar pide el PIN otra vez y luego borra', async () => {
    const { page, profiles, parental } = setup();
    await page.ngOnInit();
    page.askDelete(KIDS[0]);
    await page.confirmDelete();
    // Sin los 4 números no hace nada.
    expect(parental.verify).not.toHaveBeenCalled();
    page.onDeletePin('25a80');
    expect(page.deletePin).toBe('2580');
    await page.confirmDelete();
    expect(parental.verify).toHaveBeenCalledWith('2580');
    expect(profiles.remove).toHaveBeenCalledWith('perfil-1');
    expect(page.deleting).toBeNull();
    expect(page.profilesOk).toContain('Se eliminó el perfil de Ana');
    // Queda el otro niño elegido.
    expect(page.profiles.map((p) => p.id)).toEqual(['perfil-2']);
    expect(page.studentId).toBe('perfil-2');
  });

  it('con el PIN incorrecto no borra', async () => {
    const { page, profiles, parental } = setup();
    parental.verify.mockRejectedValueOnce(new PinError('wrong', 2));
    await page.ngOnInit();
    page.askDelete(KIDS[0]);
    page.onDeletePin('1357');
    await page.confirmDelete();
    expect(profiles.remove).not.toHaveBeenCalled();
    expect(page.deleteError).toBe('PIN incorrecto. Te quedan 2 intentos.');
    expect(page.deletePin).toBe('');
    expect(page.deleting?.id).toBe('perfil-1');
  });

  it('cancelar no borra', async () => {
    const { page, profiles } = setup();
    await page.ngOnInit();
    page.askDelete(KIDS[0]);
    page.cancelDelete();
    expect(page.deleting).toBeNull();
    expect(profiles.remove).not.toHaveBeenCalled();
  });

  it('al eliminar el último perfil el panel queda vacío', async () => {
    const { page } = setup({ kids: [KIDS[0]] });
    await page.ngOnInit();
    page.askDelete(KIDS[0]);
    page.onDeletePin('2580');
    await page.confirmDelete();
    expect(page.profiles).toEqual([]);
    expect(page.studentId).toBe('');
    expect(page.report).toBeNull();
  });

  it('muestra el tiempo típico general y por tema', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="stat-time"]')?.textContent).toBe('1 min 20 s');
    expect(el.querySelector('[data-testid="time-sumas"]')?.textContent).toContain('35 s');
    expect(el.querySelector('[data-testid="time-restas"]')?.textContent).toContain('—');
  });
});
