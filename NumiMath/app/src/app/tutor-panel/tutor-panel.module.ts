import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { StreakReminderToggleComponent } from '../core/reminders/streak-reminder-toggle.component';
import { ProfileFormComponent } from './profile-form.component';
import { RevokeConsentComponent } from './revoke-consent.component';
import { StudentExportComponent } from './student-export.component';
import { StudentHistoryComponent } from './student-history.component';
import { StudentSheetsComponent } from './student-sheets.component';
import { TeacherLinksComponent } from './teacher-links.component';
import { TutorPanelPage } from './tutor-panel.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CoreModule,
    StreakReminderToggleComponent,
    RouterModule.forChild([{ path: '', component: TutorPanelPage }]),
  ],
  declarations: [
    TutorPanelPage,
    ProfileFormComponent,
    RevokeConsentComponent,
    TeacherLinksComponent,
    StudentHistoryComponent,
    StudentSheetsComponent,
    StudentExportComponent,
  ],
})
export class TutorPanelPageModule {}
