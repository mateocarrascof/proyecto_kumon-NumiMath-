import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { DeleteAccountComponent } from './delete-account.component';
import { ProfileFormComponent } from './profile-form.component';
import { TutorPanelPage } from './tutor-panel.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CoreModule,
    RouterModule.forChild([{ path: '', component: TutorPanelPage }]),
  ],
  declarations: [TutorPanelPage, ProfileFormComponent, DeleteAccountComponent],
})
export class TutorPanelPageModule {}
