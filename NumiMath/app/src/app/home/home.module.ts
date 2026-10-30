import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { HomePage } from './home.page';
import { HomePageRoutingModule } from './home-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, CoreModule, HomePageRoutingModule],
  declarations: [HomePage],
})
export class HomePageModule {}
