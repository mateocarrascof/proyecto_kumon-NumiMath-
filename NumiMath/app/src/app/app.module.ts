import { provideHttpClient } from '@angular/common/http';
import { NgModule, inject, isDevMode, provideAppInitializer } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AccountPort } from './core/account/account.port';
import { HttpAccountService } from './core/account/http-account.service';
import { AuthPort } from './core/auth/auth.port';
import { SupabaseAuthService } from './core/auth/supabase-auth.service';
import { ConsentRevocationPort } from './core/consent/consent-revocation.port';
import { ConsentPort } from './core/consent/consent.port';
import { HttpConsentRevocationService } from './core/consent/http-consent-revocation.service';
import { SupabaseConsentService } from './core/consent/supabase-consent.service';
import { HttpPracticeService } from './core/practice/http-practice.service';
import { PracticePort } from './core/practice/practice.port';
import { HttpProgressService } from './core/progress/http-progress.service';
import { ProgressPort } from './core/progress/progress.port';
import { ProfilesPort } from './core/profiles/profiles.port';
import { SupabaseProfilesService } from './core/profiles/supabase-profiles.service';
import { MascotPort } from './core/mascot/mascot.port';
import { MascotService } from './core/mascot/mascot.service';
import { AssignmentsPort } from './core/assignments/assignments.port';
import { HttpAssignmentsService } from './core/assignments/http-assignments.service';
import { HttpReportService } from './core/report/http-report.service';
import { ReportPort } from './core/report/report.port';
import { HttpParentalService } from './core/parental/http-parental.service';
import { ParentalPort } from './core/parental/parental.port';
import { ExplanationPort } from './core/explanation/explanation.port';
import { HttpExplanationService } from './core/explanation/http-explanation.service';
import { HttpOfflineBatchService } from './core/offline/http-offline-batch.service';
import { IndexedDbOfflineStore } from './core/offline/indexeddb-offline-store';
import { OfflineBatchPort } from './core/offline/offline-batch.port';
import { OfflineStore } from './core/offline/offline-store.port';
import { startOfflinePurge } from './core/offline/offline-purge';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // CU-A12: purga de lo guardado sin conexión al iniciar y al volver a primer plano.
    provideAppInitializer(() => {
      startOfflinePurge(inject(OfflineStore));
    }),
    // Cambiar la mascota o el proveedor de sesión = cambiar estos proveedores.
    { provide: MascotPort, useExisting: MascotService },
    { provide: AuthPort, useExisting: SupabaseAuthService },
    { provide: ConsentPort, useExisting: SupabaseConsentService },
    { provide: ConsentRevocationPort, useExisting: HttpConsentRevocationService },
    { provide: ProfilesPort, useExisting: SupabaseProfilesService },
    { provide: AccountPort, useExisting: HttpAccountService },
    { provide: PracticePort, useExisting: HttpPracticeService },
    { provide: ProgressPort, useExisting: HttpProgressService },
    { provide: AssignmentsPort, useExisting: HttpAssignmentsService },
    { provide: ReportPort, useExisting: HttpReportService },
    { provide: ParentalPort, useExisting: HttpParentalService },
    { provide: ExplanationPort, useExisting: HttpExplanationService },
    { provide: OfflineStore, useExisting: IndexedDbOfflineStore },
    { provide: OfflineBatchPort, useExisting: HttpOfflineBatchService },
    provideHttpClient(),
    // CU-A12 (ADR 0002): el service worker guarda los archivos de la app para que abra sin
    // internet. Solo archivos de la app: no guarda respuestas de la API ni de Supabase (sin
    // `dataGroups`), así que ningún dato del niño queda en su caché. Apagado en desarrollo.
    provideServiceWorker('ngsw-worker.js', {
      // Solo en la web (PWA): en la app nativa (Capacitor) los archivos ya vienen dentro de la app
      // y el service worker no aporta nada.
      enabled: !isDevMode() && !Capacitor.isNativePlatform(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
