import { provideHttpClient } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AccountPort } from './core/account/account.port';
import { HttpAccountService } from './core/account/http-account.service';
import { AdminPort } from './core/admin/admin.port';
import { HttpAdminService } from './core/admin/http-admin.service';
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

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Cambiar la mascota o el proveedor de sesión = cambiar estos proveedores.
    { provide: MascotPort, useExisting: MascotService },
    { provide: AuthPort, useExisting: SupabaseAuthService },
    { provide: ConsentPort, useExisting: SupabaseConsentService },
    { provide: ConsentRevocationPort, useExisting: HttpConsentRevocationService },
    { provide: ProfilesPort, useExisting: SupabaseProfilesService },
    { provide: AccountPort, useExisting: HttpAccountService },
    { provide: AdminPort, useExisting: HttpAdminService },
    { provide: PracticePort, useExisting: HttpPracticeService },
    { provide: ProgressPort, useExisting: HttpProgressService },
    { provide: AssignmentsPort, useExisting: HttpAssignmentsService },
    { provide: ReportPort, useExisting: HttpReportService },
    { provide: ParentalPort, useExisting: HttpParentalService },
    { provide: ExplanationPort, useExisting: HttpExplanationService },
    provideHttpClient(),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
