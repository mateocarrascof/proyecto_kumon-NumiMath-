import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular/lazy';

import { AssignmentsPort, KidTasks, TutorError } from '../core/assignments/assignments.port';
import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { KidTasksPage } from './kid-tasks.page';

const TASKS: KidTasks = {
  pending: [
    { id: 't1', text: '3 + 4 = ?' },
    { id: 't2', text: '10 − 2 = ?' },
  ],
  done: [
    { id: 't0', text: '1 + 1 = ?', status: 'correct' },
    { id: 't9', text: '5 + 5 = ?', status: 'wrong' },
  ],
};

function setup(forKid: () => Promise<KidTasks> = async () => TASKS) {
  const assignments = { forKid: vi.fn(forKid) };
  const nav = { navigateForward: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    declarations: [KidTasksPage, MascotComponent],
    imports: [IonicModule.forRoot()],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: AssignmentsPort, useValue: assignments },
      { provide: NavController, useValue: nav },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'perfil-1' } } } },
    ],
  });
  const fixture = TestBed.createComponent(KidTasksPage);
  return { page: fixture.componentInstance, fixture, assignments, nav };
}

function all(fixture: { nativeElement: unknown }, selector: string): Element[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(selector));
}

describe('KidTasksPage', () => {
  it('muestra pendientes y hechas sin la respuesta', async () => {
    const { page, fixture, assignments } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    expect(assignments.forKid).toHaveBeenCalledWith('perfil-1');
    expect(all(fixture, '[data-testid="pending-task"]')).toHaveLength(2);
    const done = all(fixture, '[data-testid="done-task"]');
    expect(done.map((d) => d.textContent)).toEqual([
      expect.stringContaining('✔'),
      expect.stringContaining('↻'),
    ]);
  });

  it('tocar una tarea la abre en la práctica', async () => {
    const { page, fixture, nav } = setup();
    await page.ngOnInit();
    fixture.detectChanges();
    (all(fixture, '[data-testid="pending-task"]')[1] as HTMLElement).click();
    expect(nav.navigateForward).toHaveBeenCalledWith(['/practica', 'perfil-1'], {
      queryParams: { tareas: '1', desde: 't2', n: expect.any(String) },
    });
  });

  it('"Resolver todas" empieza por la primera', async () => {
    const { page, nav } = setup();
    await page.ngOnInit();
    await page.solve();
    expect(nav.navigateForward).toHaveBeenCalledWith(['/practica', 'perfil-1'], {
      queryParams: { tareas: '1', n: expect.any(String) },
    });
  });

  it('sin tareas lo dice con cariño', async () => {
    const { page, fixture } = setup(async () => ({ pending: [], done: [] }));
    await page.ngOnInit();
    fixture.detectChanges();
    expect(all(fixture, '[data-testid="no-tasks"]')[0]?.textContent).toContain(
      'Todavía no hay tareas',
    );
  });

  it('si falla la carga muestra un mensaje amable', async () => {
    const { page } = setup(async () => {
      throw new TutorError('network');
    });
    await page.ngOnInit();
    expect(page.error).toContain('No pude cargar tus tareas');
    expect(page.loading).toBe(false);
  });
});
