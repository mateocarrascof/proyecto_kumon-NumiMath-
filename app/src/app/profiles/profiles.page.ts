import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { NavController } from '@ionic/angular/lazy';

import { ConsentPort, LegalDocument } from '../core/consent/consent.port';
import { MascotPort } from '../core/mascot/mascot.port';
import {
  CreateFailure,
  Grade,
  MAX_PROFILES,
  NICKNAME_MAX,
  Profile,
  ProfilesPort,
} from '../core/profiles/profiles.port';

const MESSAGES: Record<CreateFailure, string> = {
  limit: `Ya tienes el máximo de ${MAX_PROFILES} perfiles.`,
  consent: 'Hay que aceptar de nuevo los términos antes de crear perfiles.',
  nickname: `El apodo debe tener entre 1 y ${NICKNAME_MAX} letras.`,
  network: 'No pude conectar con el servidor. Inténtalo de nuevo.',
  unknown: 'No pude crear el perfil. Inténtalo de nuevo.',
};

@Component({
  selector: 'app-profiles',
  templateUrl: 'profiles.page.html',
  styleUrls: ['profiles.page.scss'],
  standalone: false,
})
export class ProfilesPage implements OnInit {
  private readonly profilesPort = inject(ProfilesPort);
  private readonly consent = inject(ConsentPort);
  private readonly nav = inject(NavController);
  protected readonly mascot = inject(MascotPort);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly max = MAX_PROFILES;
  readonly nicknameMax = NICKNAME_MAX;
  readonly grades: Grade[] = [1, 2, 3, 4];

  profiles: Profile[] = [];
  declaration: LegalDocument | null = null;
  loading = true;
  showForm = false;
  nickname = '';
  grade: Grade = 1;
  declared = false;
  busy = false;
  error = '';
  pendingDelete: string | null = null;

  get full(): boolean {
    return this.profiles.length >= this.max;
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      this.profiles = await this.profilesPort.list();
      this.error = '';
    } catch {
      this.error = 'No pude cargar los perfiles. Revisa que la base esté encendida.';
      this.mascot.set('sad');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async openForm(): Promise<void> {
    this.showForm = true;
    this.error = '';
    if (!this.declaration) {
      try {
        this.declaration = (await this.consent.loadCurrent()).adult_declaration;
      } catch {
        this.error = 'No pude cargar la declaración del adulto.';
      }
      this.cdr.markForCheck();
    }
  }

  cancelForm(): void {
    this.showForm = false;
    this.nickname = '';
    this.declared = false;
    this.error = '';
  }

  async create(): Promise<void> {
    if (this.busy) return;
    if (!this.declaration?.verified) {
      this.error = 'La declaración del adulto no coincide con la versión publicada.';
      return;
    }
    if (!this.declared) {
      this.error = 'Marca la declaración del adulto para continuar.';
      return;
    }
    this.busy = true;
    this.error = '';
    const result = await this.profilesPort.create(this.nickname, this.grade);
    this.busy = false;
    this.cdr.markForCheck();
    if (result.ok) {
      this.mascot.set('happy');
      this.cancelForm();
      await this.reload();
    } else {
      this.error = MESSAGES[result.reason];
      this.mascot.set('sad');
    }
  }

  askDelete(id: string): void {
    this.pendingDelete = id;
    this.cdr.markForCheck();
  }

  async confirmDelete(): Promise<void> {
    const id = this.pendingDelete;
    this.pendingDelete = null;
    this.cdr.markForCheck();
    if (!id) return;
    if (!(await this.profilesPort.remove(id))) {
      this.error = 'No pude borrar el perfil.';
      this.cdr.markForCheck();
      return;
    }
    await this.reload();
  }

  practice(id: string): Promise<boolean> {
    return this.nav.navigateForward(['/practica', id]);
  }

  progress(id: string): Promise<boolean> {
    return this.nav.navigateForward(['/progreso', id]);
  }
}
