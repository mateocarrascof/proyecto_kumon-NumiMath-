import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  OnInit,
  Output,
  inject,
} from '@angular/core';

import { ConsentPort, LegalDocument } from '../core/consent/consent.port';
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

/** Crear un perfil (apodo, curso y declaración del adulto). Vive en el Panel del tutor. */
@Component({
  selector: 'app-profile-form',
  standalone: false,
  template: `
    <form class="form" (ngSubmit)="create()" novalidate>
      <ion-input
        label="Apodo (no uses el nombre real completo)"
        labelPlacement="stacked"
        name="nickname"
        [maxlength]="nicknameMax"
        [(ngModel)]="nickname"
      ></ion-input>
      <ion-segment [(ngModel)]="grade" name="grade" aria-label="Curso">
        @for (g of grades; track g) {
          <ion-segment-button [value]="g"><ion-label>{{ g }}° básico</ion-label></ion-segment-button>
        }
      </ion-segment>

      @if (declaration) {
        <section class="decl" aria-label="Declaración del adulto">
          <app-legal-text [text]="declaration.text"></app-legal-text>
        </section>
        <ion-checkbox
          [(ngModel)]="declared"
          name="declared"
          labelPlacement="end"
          justify="start"
          [disabled]="!declaration.verified"
        >
          Hago esta declaración ({{ declaration.version }}).
        </ion-checkbox>
      }

      <ion-button type="submit" expand="block" [disabled]="busy" data-testid="save-profile">
        {{ busy ? 'Creando…' : 'Guardar perfil' }}
      </ion-button>
      <ion-button fill="clear" expand="block" (click)="cancelled.emit()">Cancelar</ion-button>

      @if (error) {
        <p class="error" role="alert" data-testid="profile-form-error">{{ error }}</p>
      }
    </form>
  `,
  styles: [
    `
      .form { display: grid; gap: 10px; }
      .decl {
        max-height: 220px;
        overflow: auto;
        padding: 8px 12px;
        border: 1px solid var(--kid-border);
        border-radius: var(--kid-radius-sm);
        font-size: 0.9rem;
      }
      .error { color: var(--ion-color-danger); font-weight: 700; }
    `,
  ],
})
export class ProfileFormComponent implements OnInit {
  private readonly profiles = inject(ProfilesPort);
  private readonly consent = inject(ConsentPort);
  private readonly cdr = inject(ChangeDetectorRef);

  @Output() readonly created = new EventEmitter<Profile>();
  @Output() readonly cancelled = new EventEmitter<void>();

  protected readonly nicknameMax = NICKNAME_MAX;
  protected readonly grades: Grade[] = [1, 2, 3, 4];

  declaration: LegalDocument | null = null;
  nickname = '';
  grade: Grade = 1;
  declared = false;
  busy = false;
  error = '';

  async ngOnInit(): Promise<void> {
    try {
      this.declaration = (await this.consent.loadCurrent()).adult_declaration;
    } catch {
      this.error = 'No pude cargar la declaración del adulto.';
    }
    this.cdr.markForCheck();
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
    const result = await this.profiles.create(this.nickname, this.grade);
    this.busy = false;
    if (result.ok) {
      this.nickname = '';
      this.declared = false;
      this.created.emit(result.profile);
    } else {
      this.error = MESSAGES[result.reason];
    }
    this.cdr.markForCheck();
  }
}
