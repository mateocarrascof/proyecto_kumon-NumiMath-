import { provideHttpClient } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthPort } from './core/auth/auth.port';
import { SupabaseAuthService } from './core/auth/supabase-auth.service';
import { ConsentPort } from './core/consent/consent.port';
import { SupabaseConsentService } from './core/consent/supabase-consent.service';
import { MascotPort } from './core/mascot/mascot.port';
import { MascotService } from './core/mascot/mascot.service';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Cambiar la mascota o el proveedor de sesión = cambiar estos proveedores.
    { provide: MascotPort, useExisting: MascotService },
    { provide: AuthPort, useExisting: SupabaseAuthService },
    { provide: ConsentPort, useExisting: SupabaseConsentService },
    provideHttpClient(),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
