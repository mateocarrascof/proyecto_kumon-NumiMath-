import { NgModule } from '@angular/core';

import { MascotComponent } from './mascot/mascot.component';

/** Piezas compartidas por varias pantallas. */
@NgModule({
  declarations: [MascotComponent],
  exports: [MascotComponent],
})
export class CoreModule {}
