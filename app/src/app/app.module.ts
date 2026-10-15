import { provideHttpClient } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { MascotPort } from './core/mascot/mascot.port';
import { MascotService } from './core/mascot/mascot.service';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Cambiar la mascota o su comportamiento = cambiar este proveedor.
    { provide: MascotPort, useExisting: MascotService },
    provideHttpClient(),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
