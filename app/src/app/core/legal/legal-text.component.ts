import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { LegalBlock, parseLegalText } from './legal-text';

@Component({
  selector: 'app-legal-text',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (block of blocks; track $index) {
      @switch (block.kind) {
        @case ('banner') {
          <p class="banner" role="note">
            @for (run of block.runs; track $index) {
              @if (run.bold) { <strong>{{ run.text }}</strong> } @else { {{ run.text }} }
            }
          </p>
        }
        @case ('title') {
          <h3>{{ block.runs[0]?.text }}</h3>
        }
        @case ('note') {
          <p class="note">{{ block.runs[0]?.text }}</p>
        }
        @default {
          <p>
            @for (run of block.runs; track $index) {
              @if (run.bold) { <strong>{{ run.text }}</strong> } @else { {{ run.text }} }
            }
          </p>
        }
      }
    }
  `,
  styles: [
    `
      .banner { background: #fff3cd; color: #664d03; padding: 8px 12px; border-radius: 8px; }
      .note { font-size: 0.8rem; opacity: 0.7; }
      h3 { margin: 12px 0 4px; }
    `,
  ],
})
export class LegalTextComponent {
  protected blocks: LegalBlock[] = [];

  @Input() set text(value: string) {
    this.blocks = parseLegalText(value);
  }
}
