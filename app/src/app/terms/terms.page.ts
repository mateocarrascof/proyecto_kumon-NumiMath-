import { Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { AuthPort } from '../core/auth/auth.port';
import { ConsentPort, LegalBundle } from '../core/consent/consent.port';
import { MascotPort } from '../core/mascot/mascot.port';

@Component({
  selector: 'app-terms',
  templateUrl: 'terms.page.html',
  styleUrls: ['terms.page.scss'],
  standalone: false,
})
export class TermsPage implements OnInit {
  private readonly consent = inject(ConsentPort);
  private readonly auth = inject(AuthPort);
  private readonly nav = inject(NavController);
  protected readonly mascot = inject(MascotPort);

  bundle: LegalBundle | null = null;
  loading = true;
  accepted = false;
  busy = false;
  error = '';

  get verified(): boolean {
    return !!this.bundle && this.bundle.terms.verified && this.bundle.privacy.verified;
  }

  async ngOnInit(): Promise<void> {
    this.mascot.set('thinking');
    try {
      this.bundle = await this.consent.loadCurrent();
      if (this.verified) {
        this.mascot.set('idle');
      } else {
        this.error = 'Los textos no coinciden con la versión publicada. Por seguridad no se pueden aceptar.';
        this.mascot.set('sad');
      }
    } catch {
      this.error = 'No pude cargar los términos. Revisa que la base esté encendida e inténtalo de nuevo.';
      this.mascot.set('sad');
    } finally {
      this.loading = false;
    }
  }

  async accept(): Promise<void> {
    if (!this.bundle || !this.accepted || this.busy || !this.verified) return;
    this.busy = true;
    this.error = '';
    const result = await this.consent.accept(this.bundle);
    this.busy = false;
    if (result.ok) {
      this.mascot.set('happy');
      await this.nav.navigateRoot('/home');
    } else {
      this.error = 'No pude guardar tu aceptación. Inténtalo de nuevo.';
      this.mascot.set('sad');
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.mascot.set('idle');
    await this.nav.navigateRoot('/login');
  }
}
