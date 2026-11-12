import { TestBed } from '@angular/core/testing';

import { Profile } from '../profiles/profiles.port';
import { StreakReminderToggleComponent } from './streak-reminder-toggle.component';
import { STREAK_REMINDER_PANEL } from './streak-reminder.messages';
import { ReminderChange, StreakReminderService } from './streak-reminder.service';

const ANA: Profile = { id: 'p-ana', nickname: 'Ana', grade: 2, blocked: false };

function render(profile: Profile, supported = true, result: ReminderChange = 'ok', here = false) {
  const service = {
    supported: () => supported,
    setEnabled: vi.fn(async () => result),
    activeHere: async () => here,
  };
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

  it('si el sistema niega el permiso, vuelve a apagado (también en pantalla) y se lo explica', async () => {
    const { fixture, el, service, input } = render(ANA, true, 'denied');
    // Clic real: el navegador marca el casillero antes de que responda el servicio.
    input.click();
    await vi.waitFor(() => expect(service.setEnabled).toHaveBeenCalledWith('p-ana', true));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.checked).toBe(false);
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

  it('activado en otro equipo pero no en este: se ve apagado y lo explica', async () => {
    const { fixture, el, input } = render({ ...ANA, streakReminder: true }, true, 'ok', false);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.checked).toBe(false);
    expect(el.textContent).toContain(STREAK_REMINDER_PANEL.otherDevice);
  });

  it('el lector de pantalla oye de qué perfil es cada interruptor', () => {
    const { input } = render(ANA);
    expect(input.getAttribute('aria-label')).toBe(`${STREAK_REMINDER_PANEL.label} de Ana`);
  });

  it('un perfil en pausa no se puede cambiar', () => {
    const { input, el } = render({ ...ANA, blocked: true });
    expect(input.disabled).toBe(true);
    expect(el.textContent).toContain(STREAK_REMINDER_PANEL.paused);
  });
});
