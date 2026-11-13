import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  private readonly route = inject(ActivatedRoute);
  protected readonly mascot = inject(MascotPort);
  private readonly cdr = inject(ChangeDetectorRef);

  bundle: LegalBundle | null = null;
  loading = true;
  accepted = false;
  busy = false;
  error = '';
  /** Constancia que llega desde "Revocar mi consentimiento" (solo fechas; sin datos personales). */
  revocation: { when: string; purgeOn: string | null; days: number | null } | null = null;

  /**
   * "Eliminar mi cuenta" no se ofrece a quien acepta por primera vez. Sí a quien llega por una
   * revocación o por una versión nueva (necesita poder salir) y, ante la duda, también (falla
   * abierto). Sigue disponible en el panel del tutor.
   */
  showDeleteAccount = false;

  get verified(): boolean {
    return !!this.bundle && this.bundle.terms.verified && this.bundle.privacy.verified;
  }

  async ngOnInit(): Promise<void> {
    this.readRevocation();
    this.mascot.set('thinking');
    const history = this.revocation ? Promise.resolve(true) : this.consentHistory();
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
      this.showDeleteAccount = (await history) !== false;
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private async consentHistory(): Promise<boolean | null> {
    try {
      return await this.consent.hasConsentHistory();
    } catch {
      return null;
    }
  }

  private readRevocation(): void {
    const q = this.route.snapshot.queryParamMap;
    const when = formatDate(q.get('revocado'));
    if (!when) return;
    const days = Number(q.get('dias'));
    this.revocation = {
      when,
      purgeOn: formatDate(q.get('borrado')),
      // La dirección se puede manipular: un plazo absurdo se ignora (el servidor manda 30).
      days: Number.isInteger(days) && days > 0 && days <= 365 ? days : null,
    };
  }

  async accept(): Promise<void> {
    if (!this.bundle || !this.accepted || this.busy || !this.verified) return;
    this.busy = true;
    this.error = '';
    const result = await this.consent.accept(this.bundle);
    this.busy = false;
    this.cdr.markForCheck();
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

/** Fecha legible en hora local; null si no es una fecha válida (la URL puede venir manipulada). */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' });
}
