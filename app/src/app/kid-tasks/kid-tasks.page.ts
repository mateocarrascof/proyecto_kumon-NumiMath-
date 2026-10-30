import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular/lazy';

import { AssignmentsPort, KidTasks } from '../core/assignments/assignments.port';
import { pickPhrase } from '../core/mascot/mascot-phrases';
import { MascotPort } from '../core/mascot/mascot.port';

/**
 * "Tareas de tu tutor" para el niño: pendientes (tocar una para resolverla) y ya hechas (✔ / ↻).
 * Nunca muestra la respuesta: el servidor no la manda en esta vista.
 */
@Component({
  selector: 'app-kid-tasks',
  templateUrl: 'kid-tasks.page.html',
  styleUrls: ['kid-tasks.page.scss'],
  standalone: false,
})
export class KidTasksPage implements OnInit {
  private readonly assignments = inject(AssignmentsPort);
  private readonly route = inject(ActivatedRoute);
  private readonly nav = inject(NavController);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly mascot = inject(MascotPort);

  studentId = '';
  loading = true;
  error = '';
  tasks: KidTasks = { pending: [], done: [] };
  message = pickPhrase('greet');

  async ngOnInit(): Promise<void> {
    this.studentId = this.route.snapshot.paramMap.get('id') ?? '';
    this.mascot.set('thinking');
    try {
      this.tasks = await this.assignments.forKid(this.studentId);
      this.message = this.tasks.pending.length
        ? '¡Tu tutor te dejó tareas!'
        : this.tasks.done.length
          ? '¡Hiciste todas tus tareas!'
          : '';
      this.mascot.set(this.tasks.pending.length || this.tasks.done.length ? 'happy' : 'idle');
    } catch {
      this.error = 'No pude cargar tus tareas. Inténtalo en un momento.';
      this.message = '';
      this.mascot.set('sad');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  /** Resolver desde una tarea (o desde la primera) en la pantalla de práctica. */
  solve(fromId?: string): Promise<boolean> {
    // `n` cambia en cada toque: si la dirección fuera idéntica a una anterior, el router la
    // ignoraría y la práctica (que puede seguir abierta más atrás) no se enteraría.
    const queryParams: Record<string, string> = { tareas: '1', n: String(Date.now()) };
    if (fromId) queryParams['desde'] = fromId;
    return this.nav.navigateForward(['/practica', this.studentId], { queryParams });
  }
}
