import { Component, OnInit, inject } from '@angular/core';
import { addIcons } from 'ionicons';
import { alertCircle, checkmarkCircle } from 'ionicons/icons';

import { ApiHealthService, ApiStatus } from '../core/api/api-health.service';
import { MascotPort } from '../core/mascot/mascot.port';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit {
  status: ApiStatus = 'checking';

  private readonly health = inject(ApiHealthService);
  protected readonly mascot = inject(MascotPort);

  constructor() {
    addIcons({ alertCircle, checkmarkCircle });
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.status = 'checking';
    this.mascot.set('thinking');
    this.status = await this.health.check();
    this.mascot.set(this.status === 'ok' ? 'happy' : 'sad');
  }
}
