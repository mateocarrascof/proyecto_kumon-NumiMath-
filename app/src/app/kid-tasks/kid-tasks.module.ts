import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { KidTasksPage } from './kid-tasks.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    CoreModule,
    RouterModule.forChild([{ path: '', component: KidTasksPage }]),
  ],
  declarations: [KidTasksPage],
})
export class KidTasksPageModule {}
