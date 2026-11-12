import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';

import { StreakReminderToggleComponent } from '../core/reminders/streak-reminder-toggle.component';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { ProfileFormComponent } from './profile-form.component';
import { RevokeConsentComponent } from './revoke-consent.component';
import { TutorPanelPage } from './tutor-panel.page';

@NgModule({
  imports: [
    StreakReminderToggleComponent,
    CommonModule,
    FormsModule,
    IonicModule,
    CoreModule,
    RouterModule.forChild([{ path: '', component: TutorPanelPage }]),
  ],
  declarations: [TutorPanelPage, ProfileFormComponent, RevokeConsentComponent],
})
export class TutorPanelPageModule {}
