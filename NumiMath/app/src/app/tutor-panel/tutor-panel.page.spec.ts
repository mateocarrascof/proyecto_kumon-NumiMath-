import { TestBed } from '@angular/core/testing';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { Assignment, AssignmentsPort, TutorError } from '../core/assignments/assignments.port';
import { WeeklyChartComponent } from '../core/charts/weekly-chart.component';
import { ConsentPort } from '../core/consent/consent.port';
import { ConsentRevocationPort } from '../core/consent/consent-revocation.port';
import { ParentalSession } from '../core/parental/parental-session';
import { ParentalPort, PinError } from '../core/parental/parental.port';
import { Profile, ProfilesPort } from '../core/profiles/profiles.port';
import { Report, ReportPort } from '../core/report/report.port';
import { AccountPort } from '../core/account/account.port';
import { AuthPort } from '../core/auth/auth.port';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { RevokeConsentComponent } from './revoke-consent.component';
import { DeleteAccountComponent } from '../core/account/delete-account.component';
import { StreakReminderToggleComponent } from '../core/reminders/streak-reminder-toggle.component';
import { ProfileFormComponent } from './profile-form.component';
import { TeacherLinksPort } from '../core/teacher-links/teacher-links.port';
import { TeacherLinksComponent } from './teacher-links.component';
import { HistoryPort } from '../core/history/history.port';
import { StudentHistoryComponent } from './student-history.component';
import { TutorSheetsPort } from '../core/sheets/tutor-sheets.port';
import { StudentSheetsComponent } from './student-sheets.component';
import { StudentExportComponent } from './student-export.component';
import { ExportPort } from '../core/export/export.port';
import { MAX_PENDING, PANEL_TABS, TutorPanelPage } from './tutor-panel.page';

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
    update: vi.fn(async (_s: string, id: string, text: string, answer: number) => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, text, answer } : t));
    }),
    remove: vi.fn(async (_s: string, id: string) => {
      tasks = tasks.filter((t) => t.id !== id);
    }),
    forKid: vi.fn(),
    answer: vi.fn(),
  };
  const reports = { get: vi.fn(opts.report ?? (async () => REPORT)) };
  TestBed.configureTestingModule({
    declarations: [
      TutorPanelPage,
      WeeklyChartComponent,
      ProfileFormComponent,
      DeleteAccountComponent,
      RevokeConsentComponent,
      TeacherLinksComponent,
      StudentHistoryComponent,
      StudentSheetsComponent,
      StudentExportComponent,
    ],
    imports: [IonicModule.forRoot(), StreakReminderToggleComponent],
    providers: [
      { provide: AssignmentsPort, useValue: assignments },
      { provide: ReportPort, useValue: reports },
      { provide: ProfilesPort, useValue: profiles },
      { provide: ParentalPort, useValue: parental },
      { provide: ExportPort, useValue: { downloadCsv: vi.fn(async () => ({ ok: true })) } },
      { provide: AccountPort, useValue: { delete: vi.fn(async () => 'ok') } },
      { provide: ConsentRevocationPort, useValue: { revoke: vi.fn() } },
      { provide: AuthPort, useValue: { signOut: vi.fn(async () => undefined) } },
      { provide: HistoryPort, useValue: { page: vi.fn(async () => ({ ok: true, page: { items: [], hasMore: false, nextOffset: null } })) } },
      { provide: TutorSheetsPort, useValue: { list: vi.fn(async () => ({ ok: true, page: { items: [], hasMore: false, nextOffset: null, total: 0 } })) } },
      { provide: TeacherLinksPort, useValue: { list: vi.fn(async () => ({ ok: true, teachers: [] })) } },
      { provide: ConsentPort, useValue: { loadCurrent: vi.fn(async () => ({})) } },
      { provide: NavController, useValue: nav },
    ],
  });
  const session = TestBed.inject(ParentalSession);
  session.start('token-del-pin', 600);
  const fixture = TestBed.createComponent(TutorPanelPage);
  const auth = TestBed.inject(AuthPort) as unknown as { signOut: ReturnType<typeof vi.fn> };
  return { page: fixture.componentInstance, fixture, assignments, reports, nav, session, profiles, parental, auth };
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

  describe('editar una tarea pendiente (T8)', () => {
    it('solo las pendientes se pueden editar', async () => {
      const { page } = setup({ tasks: [task('a'), task('b', 'correct')] });
      await page.ngOnInit();
      page.startEdit(page.tasks[1]);
      expect(page.editing).toBeNull();
      page.startEdit(page.tasks[0]);
      expect(page.editing?.id).toBe('a');
      expect(page.editText).toBe('a + 1 = ?');
    });

    it('verifica el PIN antes de guardar y luego recarga las tareas', async () => {
      const { page, assignments, parental } = setup({ tasks: [task('a')] });
      await page.ngOnInit();
      page.startEdit(page.tasks[0]);
      page.editText = '3 + 3 = ?';
      page.editAnswer = '6';
      page.editPin = '1234';
      await page.saveEdit();
      expect(parental.verify).toHaveBeenCalledWith('1234');
      expect(assignments.update).toHaveBeenCalledWith('perfil-1', 'a', '3 + 3 = ?', 6);
      expect(parental.verify.mock.invocationCallOrder[0]).toBeLessThan(
        assignments.update.mock.invocationCallOrder[0],
      );
      expect(page.editing).toBeNull();
      expect(page.tasks[0].text).toBe('3 + 3 = ?');
    });

    it('sin 4 dígitos de PIN no se guarda', async () => {
      const { page, assignments } = setup({ tasks: [task('a')] });
      await page.ngOnInit();
      page.startEdit(page.tasks[0]);
      page.editPin = '12';
      expect(page.canSaveEdit).toBe(false);
      await page.saveEdit();
      expect(assignments.update).not.toHaveBeenCalled();
    });

    it('con un PIN incorrecto no guarda nada y lo dice', async () => {
      const { page, assignments, parental } = setup({ tasks: [task('a')] });
      parental.verify.mockRejectedValueOnce(new PinError('wrong', 2));
      await page.ngOnInit();
      page.startEdit(page.tasks[0]);
      page.editPin = '0000';
      await page.saveEdit();
      expect(assignments.update).not.toHaveBeenCalled();
      expect(page.editError).not.toBe('');
      expect(page.editPin).toBe('');
    });

    it('si la tarea ya fue respondida lo dice y no se cierra', async () => {
      const { page, assignments } = setup({ tasks: [task('a')] });
      assignments.update.mockRejectedValueOnce(new TutorError('already_answered'));
      await page.ngOnInit();
      page.startEdit(page.tasks[0]);
      page.editPin = '1234';
      await page.saveEdit();
      expect(page.editError).toContain('ya fue respondida');
      expect(page.editing).not.toBeNull();
    });
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

  it('ofrece revocar el consentimiento y eliminar la cuenta, cada uno con su explicación', async () => {
    const { fixture } = setup();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-revoke-consent [data-testid="open-revoke-consent"]')).not.toBeNull();
    expect(root.querySelector('app-delete-account [data-testid="open-delete-account"]')).not.toBeNull();
  });
});

describe('TutorPanelPage: pestañas', () => {
  async function ready(opts: Parameters<typeof setup>[0] = {}) {
    const ctx = setup(opts);
    await ctx.page.ngOnInit();
    ctx.fixture.detectChanges();
    return { ...ctx, el: ctx.fixture.nativeElement as HTMLElement };
  }
  const tabBtn = (el: HTMLElement, id: string) =>
    el.querySelector<HTMLButtonElement>(`[data-testid="panel-tab-${id}"]`)!;
  const panel = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`#panel-${id}`)!;
  const key = (el: HTMLElement, from: string, k: string) =>
    tabBtn(el, from).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('abre en Progreso; sin perfiles abre en Mis hijos', async () => {
    expect((await ready()).page.tab).toBe('progreso');
    TestBed.resetTestingModule();
    const { page, el } = await ready({ kids: [] });
    expect(page.tab).toBe('hijos');
    expect(panel(el, 'hijos').hidden).toBe(false);
    expect(el.textContent).toContain('Crea el primero en la pestaña "Mis hijos"');
  });

  it('roles ARIA: tablist, 4 tabs enlazadas a su tabpanel, solo la activa en el orden de Tab', async () => {
    const { el } = await ready();
    const list = el.querySelector('[role="tablist"]')!;
    expect(list.getAttribute('aria-label')).toBe('Secciones del panel');
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(PANEL_TABS.map((t) => t.label));
    for (const t of tabs) {
      const target = el.querySelector(`#${t.getAttribute('aria-controls')}`)!;
      expect(target.getAttribute('role')).toBe('tabpanel');
      expect(target.getAttribute('aria-labelledby')).toBe(t.id);
      expect(target.getAttribute('tabindex')).toBe('0'); // el panel recibe foco aunque empiece sin controles
      expect(t.tagName).toBe('BUTTON');
    }
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    expect(['progreso', 'tareas', 'hijos', 'cuenta'].map((id) => panel(el, id).hidden)).toEqual([
      false, true, true, true,
    ]);
  });

  it('cambiar de pestaña no navega ni borra el token del PIN', async () => {
    const { el, fixture, page, session, nav } = await ready();
    for (const id of ['tareas', 'hijos', 'cuenta', 'progreso']) {
      tabBtn(el, id).click();
      fixture.detectChanges();
      expect(page.tab).toBe(id);
      expect(panel(el, id).hidden).toBe(false);
      expect(tabBtn(el, id).getAttribute('aria-selected')).toBe('true');
    }
    expect(session.isUnlocked()).toBe(true);
    expect(nav.navigateRoot).not.toHaveBeenCalled();
    expect(nav.navigateForward).not.toHaveBeenCalled();
  });

  it('flechas, Inicio y Fin mueven la pestaña y el foco (con vuelta al otro extremo)', async () => {
    const { el, fixture, page } = await ready();
    // jsdom no enfoca botones dentro de ion-toolbar sin hidratar: se comprueba a quién se llama.
    // El foco real se verificó en el navegador.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      return undefined;
    });
    const focused = () => (focus.mock.contexts.at(-1) as HTMLElement | undefined)?.id;
    try {
      key(el, 'progreso', 'ArrowRight');
      fixture.detectChanges();
      expect(page.tab).toBe('tareas');
      expect(focused()).toBe('tab-tareas');
      key(el, 'tareas', 'End');
      fixture.detectChanges();
      expect(page.tab).toBe('cuenta');
      expect(focused()).toBe('tab-cuenta');
      key(el, 'cuenta', 'ArrowRight');
      fixture.detectChanges();
      expect(page.tab).toBe('progreso');
      key(el, 'progreso', 'ArrowLeft');
      fixture.detectChanges();
      expect(page.tab).toBe('cuenta');
      key(el, 'cuenta', 'Home');
      fixture.detectChanges();
      expect(page.tab).toBe('progreso');
      expect(focused()).toBe('tab-progreso');
      const calls = focus.mock.calls.length;
      key(el, 'progreso', 'a'); // otras teclas no hacen nada
      expect(page.tab).toBe('progreso');
      expect(focus.mock.calls.length).toBe(calls);
    } finally {
      focus.mockRestore();
    }
  });

  it('todos los data-testid siguen en la página (las pestañas ocultas no se quitan del DOM)', async () => {
    const { el, page, fixture } = await ready({ tasks: [task('a')] });
    page.startEdit(page.tasks[0]);
    page.askDelete(page.profiles[0]);
    fixture.detectChanges();
    for (const id of [
      'stat-total', 'stat-percent', 'stat-time', 'time-sumas', 'student-history',
      'save-task', 'task', 'edit-task', 'edit-form', 'edit-pin', 'save-edit', 'cancel-edit',
      'kid-Ana', 'kid-Beto', 'admin-Ana', 'delete-pin', 'confirm-delete',
      'teacher-links', 'student-sheets', 'student-export',
      'open-revoke-consent', 'open-delete-account',
    ]) {
      expect(el.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
  });

  it('el selector de niño se ve en Progreso, Tareas y Mis hijos, y se oculta en Cuenta', async () => {
    const { el, fixture } = await ready();
    for (const [id, visible] of [['progreso', true], ['tareas', true], ['hijos', true], ['cuenta', false]] as const) {
      tabBtn(el, id).click();
      fixture.detectChanges();
      expect(!!el.querySelector('[data-testid="kid-Ana"]'), id).toBe(visible);
    }
  });
});

describe('TutorPanelPage: secciones plegables', () => {
  it('historial, docentes, hojas, exportar y la zona delicada empiezan plegados y conservan su contenido', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const folds: [string, string, string][] = [
      ['fold-history', 'panel-progreso', 'student-history'],
      ['fold-teachers', 'panel-hijos', 'teacher-links'],
      ['fold-sheets', 'panel-hijos', 'student-sheets'],
      ['fold-export', 'panel-hijos', 'student-export'],
      ['fold-revoke', 'panel-cuenta', 'open-revoke-consent'],
      ['fold-delete', 'panel-cuenta', 'open-delete-account'],
    ];
    for (const [fold, tabPanel, inner] of folds) {
      const d = el.querySelector<HTMLDetailsElement>(`[data-testid="${fold}"]`)!;
      expect(d.tagName, fold).toBe('DETAILS');
      expect(d.open, fold).toBe(false);
      expect(d.closest(`#${tabPanel}`), fold).not.toBeNull();
      expect(d.querySelector(':scope > summary')?.textContent?.trim(), fold).toBeTruthy();
      expect(d.querySelector(`[data-testid="${inner}"]`), fold).not.toBeNull();
    }
    const danger = el.querySelector('[data-testid="danger-zone"]')!;
    // Títulos visibles sin abrir nada.
    expect(danger.querySelector('[data-testid="fold-revoke"] > summary')?.textContent?.trim()).toBe(
      'Revocar mi consentimiento',
    );
    expect(danger.querySelector('[data-testid="fold-delete"] > summary')?.textContent?.trim()).toBe(
      'Eliminar mi cuenta',
    );
    // Al fondo de Cuenta: después de "Cambiar PIN" y "Cerrar sesión".
    expect(el.querySelector('#panel-cuenta')!.lastElementChild).toBe(danger);
  });

  it('Cuenta muestra siempre "Tus derechos sobre los datos" y cada enlace abre su sección', async () => {
    const { page, fixture } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const line = el.querySelector('#panel-cuenta [data-testid="rights-line"]')!;
    expect(line.closest('details')).toBeNull(); // no está plegada
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Tus derechos sobre los datos: exportar, revocar, eliminar.',
    );
    const cases: [string, string, string][] = [
      ['right-export', 'hijos', 'fold-export'],
      ['right-revoke', 'cuenta', 'fold-revoke'],
      ['right-delete', 'cuenta', 'fold-delete'],
    ];
    for (const [link, tab, fold] of cases) {
      page.selectTab('cuenta');
      fixture.detectChanges();
      el.querySelector<HTMLElement>(`[data-testid="${link}"]`)!.click();
      fixture.detectChanges();
      expect(page.tab, link).toBe(tab);
      const d = el.querySelector<HTMLDetailsElement>(`[data-testid="${fold}"]`)!;
      expect(d.open, link).toBe(true);
      expect(d.closest('[role="tabpanel"]')?.hasAttribute('hidden'), link).toBe(false);
      d.open = false;
    }
  });
});

describe('TutorPanelPage: cerrar sesión (pestaña Cuenta)', () => {
  it('cierra la sesión, borra el token del PIN y va a /login', async () => {
    const { page, fixture, nav, session, auth } = setup();
    await page.ngOnInit();
    page.selectTab('cuenta');
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="panel-sign-out"]');
    expect(button?.closest('#panel-cuenta')).not.toBeNull();
    button!.click();
    await fixture.whenStable();
    expect(session.isUnlocked()).toBe(false);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(nav.navigateRoot).toHaveBeenCalledWith('/login');
  });

  it('si cerrar sesión falla, igual sale a /login sin token (el panel no queda a la vista)', async () => {
    const { page, nav, session, auth } = setup();
    await page.ngOnInit();
    auth.signOut.mockRejectedValueOnce(new Error('red'));
    await expect(page.signOut()).resolves.toBeUndefined();
    expect(session.isUnlocked()).toBe(false);
    expect(nav.navigateRoot).toHaveBeenCalledWith('/login');
  });

  it('mientras cierra sesión el botón queda desactivado y un segundo toque no repite', async () => {
    const { page, fixture, auth } = setup();
    await page.ngOnInit();
    let release!: () => void;
    auth.signOut.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const first = page.signOut();
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLIonButtonElement>('[data-testid="panel-sign-out"]');
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain('Cerrando sesión…');
    await page.signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('sin conexión no se ofrece ni hace nada (como en /home, CU-A12)', async () => {
    const { page, fixture, nav, session, auth } = setup();
    await page.ngOnInit();
    TestBed.inject(ConnectivityService).reportNetworkFailure();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="panel-sign-out"]')).toBeNull();
    await page.signOut();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(session.isUnlocked()).toBe(true);
    expect(nav.navigateRoot).not.toHaveBeenCalled();
  });
});
