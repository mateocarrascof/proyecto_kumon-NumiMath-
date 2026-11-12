import { TestBed } from '@angular/core/testing';

import { Profile } from '../profiles/profiles.port';
import { StreakReminderToggleComponent } from './streak-reminder-toggle.component';
import { STREAK_REMINDER_PANEL } from './streak-reminder.messages';
import { ReminderChange, StreakReminderService } from './streak-reminder.service';

const ANA: Profile = { id: 'p-ana', nickname: 'Ana', grade: 2, blocked: false };

function render(profile: Profile, supported = true, result: ReminderChange = 'ok') {
  const service = { supported: () => supported, setEnabled: vi.fn(async () => result) };
  TestBed.configureTestingModule({
    imports: [StreakReminderToggleComponent],
    providers: [{ provide: StreakReminderService, useValue: service }],
  });
  const fixture = TestBed.createComponent(StreakReminderToggleComponent);
  fixture.componentRef.setInput('profile', profile);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, service, input: el.querySelector('[data-testid="reminder-switch"]') as HTMLInputElement };
}

describe('StreakReminderToggleComponent (CU-A9)', () => {
  it('apagado por defecto', () => {
    const { input } = render(ANA);
    expect(input.checked).toBe(false);
  });

  it('en la web no se ofrece: "Disponible en la app del teléfono o tablet"', () => {
    const { el, input } = render(ANA, false);
    expect(input).toBeNull();
    expect(el.textContent).toContain(STREAK_REMINDER_PANEL.unsupported);
  });

  it('si el sistema niega el permiso, vuelve a apagado y se lo explica al adulto', async () => {
    const { fixture, el, service } = render(ANA, true, 'denied');
    await fixture.componentInstance.toggle(true);
    fixture.detectChanges();
    expect(service.setEnabled).toHaveBeenCalledWith('p-ana', true);
    expect((el.querySelector('[data-testid="reminder-switch"]') as HTMLInputElement).checked).toBe(false);
    expect(el.querySelector('[data-testid="reminder-message"]')?.textContent).toContain(
      STREAK_REMINDER_PANEL.denied,
    );
  });

  it('con el PIN vencido pide volver a escribirlo', async () => {
    const { fixture, el } = render(ANA, true, 'pin');
    await fixture.componentInstance.toggle(true);
    fixture.detectChanges();
    expect(el.textContent).toContain(STREAK_REMINDER_PANEL.pin);
  });

  it('activado con éxito queda encendido', async () => {
    const { fixture, el } = render(ANA);
    await fixture.componentInstance.toggle(true);
    fixture.detectChanges();
    expect((el.querySelector('[data-testid="reminder-switch"]') as HTMLInputElement).checked).toBe(true);
  });

  it('un perfil en pausa no se puede cambiar', () => {
    const { input, el } = render({ ...ANA, blocked: true });
    expect(input.disabled).toBe(true);
    expect(el.textContent).toContain(STREAK_REMINDER_PANEL.paused);
  });
});
