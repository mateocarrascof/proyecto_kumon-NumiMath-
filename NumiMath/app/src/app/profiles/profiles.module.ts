import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { OfflineNoticeComponent } from '../core/offline/offline-notice.component';
import { ProfilesPage } from './profiles.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CoreModule,
    OfflineNoticeComponent,
    RouterModule.forChild([{ path: '', component: ProfilesPage }]),
  ],
  declarations: [ProfilesPage],
})
export class ProfilesPageModule {}
