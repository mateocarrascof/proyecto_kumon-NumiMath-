import { TestBed } from '@angular/core/testing';

import { MemoryOfflineStore } from './app/core/offline/memory-offline-store';
import { OfflineBatchError, OfflineBatchPort } from './app/core/offline/offline-batch.port';
import { OfflineStore } from './app/core/offline/offline-store.port';
import { OfflineSyncError, OfflineSyncPort } from './app/core/offline/offline-sync.port';
import { ReminderNotifier } from './app/core/reminders/reminder-notifier.port';

// Polyfills for running unit tests under jsdom (the default Vitest environment).
// Ionic components such as ion-menu and ion-split-pane query `window.matchMedia`,
// which jsdom does not implement.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// CU-A12: jsdom no trae IndexedDB. Por defecto, cada prueba usa un almacén en memoria y una
// descarga del lote que falla por red (como sin internet). Una prueba que necesite otra cosa
// los reemplaza en su propio `configureTestingModule` (el último proveedor gana). Se vuelven a
// registrar tras cada `resetTestingModule`, porque algunas pruebas reinician el módulo a mitad.
function offlineDefaults(): void {
  TestBed.configureTestingModule({
    providers: [
      { provide: OfflineStore, useFactory: () => new MemoryOfflineStore() },
      {
        provide: OfflineBatchPort,
        useValue: {
          download: async () => {
            throw new OfflineBatchError('network');
          },
        },
      },
      // CU-A9: sin plugin de avisos (como en la web): el recordatorio no hace nada.
      {
        provide: ReminderNotifier,
        useValue: {
          supported: () => false,
          requestPermission: async () => false,
          pending: async () => null,
          schedule: async () => undefined,
          cancel: async () => undefined,
          onTap: () => undefined,
        },
      },
      // CU-A13: el envío de la cola también falla por red por defecto.
      {
        provide: OfflineSyncPort,
        useValue: {
          send: async () => {
            throw new OfflineSyncError('network');
          },
        },
      },
    ],
  });
}

const reset = TestBed.resetTestingModule.bind(TestBed);
TestBed.resetTestingModule = () => {
  const result = reset();
  offlineDefaults();
  return result;
};

beforeEach(() => offlineDefaults());
