/**
 * Avisos LOCALES del dispositivo (CU-A9, ADR 0003). Implementación real: plugin oficial
 * `@capacitor/local-notifications`. Las pruebas usan uno falso (jsdom no tiene el plugin).
 * Hay a lo sumo UN aviso programado por dispositivo.
 */
export abstract class ReminderNotifier {
  /** Solo en la app nativa (Android/iOS). En la web/PWA el aviso no es confiable: no se ofrece. */
  abstract supported(): boolean;
  /** Pide el permiso del sistema. Se llama solo desde el panel del tutor. */
  abstract requestPermission(): Promise<boolean>;
  /** Hora del aviso ya programado, o null. */
  abstract pending(): Promise<Date | null>;
  /** Programa el único aviso (reemplaza al anterior). */
  abstract schedule(at: Date, title: string, body: string): Promise<void>;
  abstract cancel(): Promise<void>;
  /** Al tocar el aviso. */
  abstract onTap(handler: () => void): void;
}
