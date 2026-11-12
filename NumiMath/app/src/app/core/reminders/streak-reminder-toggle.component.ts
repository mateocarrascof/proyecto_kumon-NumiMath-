import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  inject,
} from '@angular/core';

import { Profile } from '../profiles/profiles.port';
import { STREAK_REMINDER_PANEL } from './streak-reminder.messages';
import { StreakReminderService } from './streak-reminder.service';

/**
 * CU-A9: interruptor "Recordatorio de racha" de un perfil, SOLO en el panel del tutor (con PIN
 * vigente). Apagado por defecto. Se ve encendido solo si está activo en el servidor Y en este
 * equipo (activación por equipo). En la web no se ofrece (solo en la app del teléfono o tablet).
 * Componente aparte para no sumar estilos a la hoja del panel.
 */
@Component({
  selector: 'app-streak-reminder-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="reminder" [attr.data-testid]="'reminder-' + profile.id">
      @if (!supported) {
        <p class="note">{{ text.label }}: {{ text.unsupported }}</p>
      } @else {
        <label class="row">
          <input
            #box
            type="checkbox"
            role="switch"
            [checked]="enabled"
            [disabled]="busy || profile.blocked"
            [attr.aria-busy]="busy"
            [attr.aria-label]="text.label + ' de ' + profile.nickname"
            [attr.aria-describedby]="'reminder-help-' + profile.id"
            (change)="toggle(box.checked, box)"
            data-testid="reminder-switch"
          />
          <span aria-hidden="true">{{ text.label }}</span>
        </label>
        <p class="note" [id]="'reminder-help-' + profile.id">
          {{ profile.blocked ? text.paused : otherDevice ? text.otherDevice : text.help }}
        </p>
      }
      @if (message) {
        <p class="msg" role="status" data-testid="reminder-message">{{ message }}</p>
      }
    </div>
  `,
  styles: [
    `
      .reminder {
        margin-top: 0.5rem;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        min-height: 44px; /* objetivo táctil cómodo */
        font-weight: 600;
      }
      input {
        width: 24px;
        height: 24px;
      }
      .note,
      .msg {
        margin: 0.25rem 0 0;
        font-size: 0.95rem;
      }
    `,
  ],
})
export class StreakReminderToggleComponent implements OnChanges {
  @Input({ required: true }) profile!: Profile;

  private readonly reminders = inject(StreakReminderService);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly text = STREAK_REMINDER_PANEL;
  protected readonly supported = this.reminders.supported();
  protected busy = false;
  protected message = '';
  private here = false;
  private override: boolean | null = null;

  /** Encendido = activo en el servidor y en este equipo. */
  protected get enabled(): boolean {
    return this.override ?? (this.profile.streakReminder === true && this.here);
  }

  /** Activo en otro equipo del tutor, pero no en este. */
  protected get otherDevice(): boolean {
    return this.override === null && this.profile.streakReminder === true && !this.here;
  }

  ngOnChanges(): void {
    // Perfil recargado: manda lo que diga el servidor (se olvida el último cambio local).
    this.override = null;
    if (!this.supported) return;
    void this.reminders.activeHere(this.profile.id).then((here) => {
      this.here = here;
      this.cdr.markForCheck();
    });
  }

  async toggle(enabled: boolean, box?: HTMLInputElement): Promise<void> {
    this.busy = true;
    this.message = '';
    this.cdr.markForCheck();
    const result = await this.reminders.setEnabled(this.profile.id, enabled);
    if (result === 'ok') {
      this.override = enabled;
      this.here = enabled;
    } else {
      // No quedó guardado: el interruptor vuelve a como estaba. Se corrige también el DOM, porque
      // si el valor enlazado no cambió Angular no reescribe `checked` (quedaría encendido).
      this.override = !enabled;
      if (box) box.checked = !enabled;
      this.message =
        result === 'denied'
          ? this.text.denied
          : result === 'pin'
            ? this.text.pin
            : result === 'unsupported'
              ? this.text.unsupported
              : this.text.error;
    }
    this.busy = false;
    this.cdr.markForCheck();
  }
}
