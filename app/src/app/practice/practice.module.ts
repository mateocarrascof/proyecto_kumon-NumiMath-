import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { PracticePage } from './practice.page';
import { SkillTilesComponent } from './skill-tiles.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CoreModule,
    RouterModule.forChild([{ path: '', component: PracticePage }]),
  ],
  declarations: [PracticePage, SkillTilesComponent],
})
export class PracticePageModule {}
