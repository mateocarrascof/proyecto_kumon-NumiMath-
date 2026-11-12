import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';
import { addIcons } from 'ionicons';
import { alertCircle, checkmarkCircle } from 'ionicons/icons';

import { ApiHealthService, ApiStatus } from '../core/api/api-health.service';
import { AuthPort } from '../core/auth/auth.port';
import { pickPhrase } from '../core/mascot/mascot-phrases';
import { MascotPort } from '../core/mascot/mascot.port';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { isOffline } from '../core/offline/offline-access';
import { OFFLINE_MESSAGES } from '../core/offline/offline-notice.component';

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
  protected readonly greeting = pickPhrase('greet');
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly auth = inject(AuthPort);
  private readonly connectivity = inject(ConnectivityService);
  /** Aviso si "Panel del tutor" no puede abrirse sin conexión. */
  offlineNotice = '';

  /**
   * Sin conexión se oculta "Cerrar sesión": borraría los intentos guardados sin enviar y dejaría
   * al niño fuera de la app sin poder volver a entrar hasta tener internet.
   */
  protected offline(): boolean {
    return isOffline(this.connectivity);
  }

  async openPanel(): Promise<void> {
    this.offlineNotice = '';
    const opened = await this.nav.navigateForward('/panel');
    if (!opened && isOffline(this.connectivity)) this.offlineNotice = OFFLINE_MESSAGES.needsInternet;
    this.cdr.markForCheck();
  }

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
