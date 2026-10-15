import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';
import { addIcons } from 'ionicons';
import { alertCircle, checkmarkCircle } from 'ionicons/icons';

import { ApiHealthService, ApiStatus } from '../core/api/api-health.service';
import { AuthPort } from '../core/auth/auth.port';
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
  private readonly nav = inject(NavController);
  protected readonly mascot = inject(MascotPort);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly auth = inject(AuthPort);

  constructor() {
    addIcons({ alertCircle, checkmarkCircle });
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.status = 'checking';
    this.cdr.markForCheck();
    this.mascot.set('thinking');
    this.status = await this.health.check();
    this.mascot.set(this.status === 'ok' ? 'happy' : 'sad');
    this.cdr.markForCheck();
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.mascot.set('idle');
    // navigateRoot vacía la pila: la pantalla anterior (con el correo) no queda en memoria.
    await this.nav.navigateRoot('/login');
  }
}
