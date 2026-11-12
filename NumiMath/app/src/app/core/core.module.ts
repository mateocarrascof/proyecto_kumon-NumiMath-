import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { DeleteAccountComponent } from './account/delete-account.component';
import { ConfettiComponent } from './celebration/confetti.component';
import { WeeklyChartComponent } from './charts/weekly-chart.component';
import { LegalTextComponent } from './legal/legal-text.component';
import { MascotComponent } from './mascot/mascot.component';
import { FractionInputComponent } from './math/fraction-input.component';
import { MathTextComponent } from './math/math-text.component';
import { ScratchpadComponent } from './scratchpad/scratchpad.component';
import { SheetViewComponent } from './sheets/sheet-view.component';
import { GentleTimerComponent } from './timer/gentle-timer.component';

/** Piezas compartidas por varias pantallas. */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule],
  declarations: [
    DeleteAccountComponent,
    MascotComponent,
    LegalTextComponent,
    ConfettiComponent,
    ScratchpadComponent,
    SheetViewComponent,
    WeeklyChartComponent,
    GentleTimerComponent,
    MathTextComponent,
    FractionInputComponent,
  ],
  exports: [
    DeleteAccountComponent,
    MascotComponent,
    LegalTextComponent,
    ConfettiComponent,
    ScratchpadComponent,
    SheetViewComponent,
    WeeklyChartComponent,
    GentleTimerComponent,
    MathTextComponent,
    FractionInputComponent,
  ],
})
export class CoreModule {}
