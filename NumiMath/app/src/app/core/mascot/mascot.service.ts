import { Injectable, signal } from '@angular/core';

import { MascotPort, MascotState } from './mascot.port';

@Injectable({ providedIn: 'root' })
export class MascotService extends MascotPort {
  private readonly current = signal<MascotState>('idle');

  readonly state = this.current.asReadonly();

  set(state: MascotState): void {
    this.current.set(state);
  }
}
