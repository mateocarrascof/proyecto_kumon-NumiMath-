import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { Topic } from '../core/practice/practice.port';
import { TopicGroup, moduleStyle, tileLabel, topicIcon } from './practice.page';

/**
 * Selector de habilidades en baldosas, agrupadas por eje (o por curso en el repaso).
 * Cada eje tiene su color e ícono fijos; ninguna habilidad tiene candado.
 * Separado de la pantalla de práctica para mantener sus estilos livianos.
 */
@Component({
  selector: 'app-skill-tiles',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['skill-tiles.component.scss'],
  template: `
    @for (g of groups; track g.title) {
      <section class="skill-group" [attr.data-tone]="g.style.tone" data-testid="skill-group">
        <h2 class="group-title">
          <span class="group-icon" aria-hidden="true">{{ g.style.icon }}</span>
          <span class="group-name">{{ titlePrefix }}{{ g.title }}</span>
          @if (showMastered && g.mastered) {
            <span class="group-count">{{ g.mastered }} de {{ g.topics.length }} dominadas</span>
          }
        </h2>
        <ul class="tiles">
          @for (t of g.topics; track t.id) {
            <li>
              <!-- Nombre completo (nunca se corta), estrellas y avance del bloque. -->
              <button type="button" class="tile" [attr.data-tone]="tone(t)" [class.mastered]="t.mastered"
                [attr.aria-label]="label(t)" (click)="pick.emit(t)" data-testid="topic-tile">
                @if (t.review && t.grade) {
                  <span class="tile-grade" aria-hidden="true">{{ t.grade }}°</span>
                }
                <span class="tile-icon" aria-hidden="true">{{ icon(t.label) }}</span>
                <span class="tile-name">{{ t.label }}</span>
                <span class="tile-foot" aria-hidden="true">
                  @if (t.mastered) {
                    <span class="tile-mastered" data-testid="tile-mastered">✅ Dominada</span>
                  } @else {
                    <span class="tile-stars">{{ stars(t.level ?? 1) }}</span>
                    <span class="tile-progress">
                      <span class="tile-bar"><span class="tile-fill" [style.width.%]="percent(t)"></span></span>
                      <span class="tile-count">{{ t.blockDone ?? 0 }}/{{ t.blockSize ?? 10 }}</span>
                    </span>
                  }
                </span>
              </button>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class SkillTilesComponent {
  @Input() groups: TopicGroup[] = [];
  /** Antes del nombre del grupo (p. ej. "Repaso de "). */
  @Input() titlePrefix = '';
  /** Mostrar "N de M dominadas" en el encabezado del grupo. */
  @Input() showMastered = true;
  @Output() readonly pick = new EventEmitter<Topic>();

  protected readonly icon = topicIcon;
  protected readonly label = tileLabel;

  protected tone(topic: Topic): string {
    return moduleStyle(topic.module).tone;
  }

  protected stars(level: number): string {
    return '★'.repeat(level) + '☆'.repeat(3 - level);
  }

  /** Avance del bloque en curso (0–100), para la barrita. */
  percent(topic: Topic): number {
    const size = topic.blockSize ?? 10;
    return size > 0 ? Math.min(100, Math.round(((topic.blockDone ?? 0) / size) * 100)) : 0;
  }
}
