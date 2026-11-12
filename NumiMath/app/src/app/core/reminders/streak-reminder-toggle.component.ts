import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, inject } from '@angular/core';

import { Profile } from '../profiles/profiles.port';
import { STREAK_REMINDER_PANEL } from './streak-reminder.messages';
import { StreakReminderService } from './streak-reminder.service';

/**
 * CU-A9: interruptor "Recordatorio de racha" de un perfil, SOLO en el panel del tutor (con PIN
 * vigente). Apagado por defecto. En la web no se ofrece (solo en la app del teléfono o tablet).
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
            type="checkbox"
            role="switch"
            [checked]="enabled"
            [disabled]="busy || profile.blocked"
            [attr.aria-describedby]="'reminder-help-' + profile.id"
            (change)="toggle($any($event.target).checked)"
            data-testid="reminder-switch"
          />
          <span>{{ text.label }}</span>
        </label>
        <p class="note" [id]="'reminder-help-' + profile.id">
          {{ profile.blocked ? text.paused : text.help }}
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
export class StreakReminderToggleComponent {
  @Input({ required: true }) profile!: Profile;

  private readonly reminders = inject(StreakReminderService);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly text = STREAK_REMINDER_PANEL;
  protected readonly supported = this.reminders.supported();
  protected busy = false;
  protected message = '';
  private override: boolean | null = null;

  protected get enabled(): boolean {
    return this.override ?? this.profile.streakReminder === true;
  }

  async toggle(enabled: boolean): Promise<void> {
    this.busy = true;
    this.message = '';
    this.cdr.markForCheck();
    const result = await this.reminders.setEnabled(this.profile.id, enabled);
    if (result === 'ok') {
      this.override = enabled;
    } else {
      // No quedó guardado: el interruptor vuelve a como estaba.
      this.override = !enabled;
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
