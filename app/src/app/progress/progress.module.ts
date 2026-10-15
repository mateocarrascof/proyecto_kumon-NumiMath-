import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { ProgressPage } from './progress.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    CoreModule,
    RouterModule.forChild([{ path: '', component: ProgressPage }]),
  ],
  declarations: [ProgressPage],
})
export class ProgressPageModule {}
