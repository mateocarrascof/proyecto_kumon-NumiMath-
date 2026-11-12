import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { OfflineNoticeComponent } from '../core/offline/offline-notice.component';
import { HomePage } from './home.page';
import { HomePageRoutingModule } from './home-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, CoreModule, HomePageRoutingModule, OfflineNoticeComponent],
  declarations: [HomePage],
})
export class HomePageModule {}
