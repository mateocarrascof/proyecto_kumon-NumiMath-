import { NgModule } from '@angular/core';

import { ConfettiComponent } from './celebration/confetti.component';
import { WeeklyChartComponent } from './charts/weekly-chart.component';
import { LegalTextComponent } from './legal/legal-text.component';
import { MascotComponent } from './mascot/mascot.component';
import { FractionInputComponent } from './math/fraction-input.component';
import { MathTextComponent } from './math/math-text.component';
import { ScratchpadComponent } from './scratchpad/scratchpad.component';
import { GentleTimerComponent } from './timer/gentle-timer.component';

/** Piezas compartidas por varias pantallas. */
@NgModule({
  declarations: [
    MascotComponent,
    LegalTextComponent,
    ConfettiComponent,
    ScratchpadComponent,
    WeeklyChartComponent,
    GentleTimerComponent,
    MathTextComponent,
    FractionInputComponent,
  ],
  exports: [
    MascotComponent,
    LegalTextComponent,
    ConfettiComponent,
    ScratchpadComponent,
    WeeklyChartComponent,
    GentleTimerComponent,
    MathTextComponent,
    FractionInputComponent,
  ],
})
export class CoreModule {}
