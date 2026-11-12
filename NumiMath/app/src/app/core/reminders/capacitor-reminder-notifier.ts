import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

import { ReminderNotifier } from './reminder-notifier.port';

/** Id fijo: hay un solo aviso por dispositivo, sin importar cuántos perfiles lo tengan activo. */
const NOTIFICATION_ID = 1009;
const CHANNEL_ID = 'recordatorio-racha';

/**
 * Plugin oficial de notificaciones locales. Sin servidor de push ni tokens: el aviso se arma y se
 * muestra en el propio dispositivo, y no sale ningún dato.
 *
 * - Android: canal de importancia normal (3), sin saltarse "no molestar". Alarma INEXACTA (sin
 *   `allowWhileIdle`): no hace falta el permiso de alarmas exactas, a cambio de que el aviso pueda
 *   llegar unos minutos tarde. Desde Android 13 el sistema pide permiso para mostrar avisos.
 * - iOS: el sistema pide autorización; respeta "no molestar" y los modos de concentración.
 */
@Injectable({ providedIn: 'root' })
export class CapacitorReminderNotifier extends ReminderNotifier {
  private channelReady = false;

  supported(): boolean {
    return Capacitor.isNativePlatform();
  }

  async requestPermission(): Promise<boolean> {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return true;
    const asked = await LocalNotifications.requestPermissions();
    return asked.display === 'granted';
  }

  async pending(): Promise<Date | null> {
    const { notifications } = await LocalNotifications.getPending();
    const at = notifications.find((n) => n.id === NOTIFICATION_ID)?.schedule?.at;
    return at ? new Date(at) : null;
  }

  async schedule(at: Date, title: string, body: string): Promise<void> {
    await this.ensureChannel();
    await this.cancel();
    await LocalNotifications.schedule({
      notifications: [
        { id: NOTIFICATION_ID, title, body, channelId: CHANNEL_ID, schedule: { at } },
      ],
    });
  }

  async cancel(): Promise<void> {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
  }

  onTap(handler: () => void): void {
    void LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      if (event.notification.id === NOTIFICATION_ID) handler();
    });
  }

  private async ensureChannel(): Promise<void> {
    if (this.channelReady || Capacitor.getPlatform() !== 'android') return;
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Recordatorio de racha',
      description: 'Un aviso al día para practicar, si el adulto lo activó.',
      importance: 3,
    });
    this.channelReady = true;
  }
}
