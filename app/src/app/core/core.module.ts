import { NgModule } from '@angular/core';

import { LegalTextComponent } from './legal/legal-text.component';
import { MascotComponent } from './mascot/mascot.component';

/** Piezas compartidas por varias pantallas. */
@NgModule({
  declarations: [MascotComponent, LegalTextComponent],
  exports: [MascotComponent, LegalTextComponent],
})
export class CoreModule {}
