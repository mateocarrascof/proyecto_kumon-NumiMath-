import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { MascotPort } from '../core/mascot/mascot.port';
import { PracticeError } from '../core/practice/practice.port';
import { Progress, ProgressPort } from '../core/progress/progress.port';

const MESSAGES: Record<string, string> = {
  session: 'Tu sesión no es válida, vuelve a iniciar sesión.',
  forbidden: 'No tienes acceso a este perfil.',
  network: 'No pude conectar con el servidor. ¿Está encendido?',
  unavailable: 'No pude cargar el progreso. Inténtalo en un momento.',
};

@Component({
  selector: 'app-progress',
  templateUrl: 'progress.page.html',
  styleUrls: ['progress.page.scss'],
  standalone: false,
})
export class ProgressPage implements OnInit {
  private readonly progressPort = inject(ProgressPort);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly mascot = inject(MascotPort);

  studentId = '';
  progress: Progress | null = null;
  loading = true;
  error = '';

  get percent(): number {
    const p = this.progress;
    return p && p.total > 0 ? Math.round((p.correct / p.total) * 100) : 0;
  }

  ratio(correct: number, total: number): number {
    return total > 0 ? correct / total : 0;
  }

  async ngOnInit(): Promise<void> {
    this.studentId = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      this.progress = await this.progressPort.get(this.studentId);
      this.mascot.set(this.progress.total > 0 && this.percent >= 70 ? 'happy' : 'idle');
    } catch (error) {
      this.error = MESSAGES[error instanceof PracticeError ? error.code : 'unavailable'] ?? MESSAGES['unavailable'];
      this.mascot.set('sad');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }
}
