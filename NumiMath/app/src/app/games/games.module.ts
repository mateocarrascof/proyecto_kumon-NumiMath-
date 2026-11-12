import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { CoreModule } from '../core/core.module';
import { ChoiceOptionsComponent } from '../core/games/choice-options.component';
import { GameVisualComponent } from '../core/games/game-visual.component';
import { OrderCardsComponent } from '../core/games/order-cards.component';
import { GamesPage } from './games.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    CoreModule,
    ChoiceOptionsComponent,
    OrderCardsComponent,
    GameVisualComponent,
    RouterModule.forChild([{ path: '', component: GamesPage }]),
  ],
  declarations: [GamesPage],
})
export class GamesPageModule {}
