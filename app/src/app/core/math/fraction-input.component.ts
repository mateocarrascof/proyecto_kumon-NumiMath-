import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export interface FractionValue {
  num: string;
  den: string;
}

/** Solo dígitos, máximo 4 (la respuesta es un número, nunca texto libre). */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 4);
}

/**
 * Casilla de fracción: numerador arriba, raya, denominador abajo. El niño escribe ambos números
 * a mano, como en su cuaderno. Enter en el numerador pasa al denominador; en el denominador,
 * responde.
 */
@Component({
  selector: 'app-fraction-input',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fraction" role="group" aria-label="Tu respuesta como fracción">
      <input
        #num
        class="box"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        aria-label="Numerador (arriba)"
        placeholder="?"
        data-testid="fraction-num"
        [value]="value.num"
        (input)="change('num', num.value); num.value = value.num"
        (keyup.enter)="den.focus()"
      />
      <span class="bar" aria-hidden="true"></span>
      <input
        #den
        class="box"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        aria-label="Denominador (abajo)"
        placeholder="?"
        data-testid="fraction-den"
        [value]="value.den"
        (input)="change('den', den.value); den.value = value.den"
        (keyup.enter)="submitted.emit()"
      />
    </div>
  `,
  styles: `
    .fraction {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin: 8px auto 12px;
    }
    .box {
      width: 96px;
      height: 56px;
      font: inherit;
      font-size: 1.8rem;
      font-weight: 800;
      text-align: center;
      color: var(--ion-text-color);
      background: var(--kid-card-bg);
      border: 3px solid var(--kid-lilac-soft);
      border-radius: 14px;
    }
    .box:focus-visible {
      outline: none;
      border-color: var(--ion-color-primary);
      box-shadow: 0 0 0 5px var(--kid-teal-soft);
    }
    .bar {
      width: 120px;
      height: 5px;
      border-radius: 3px;
      background: var(--ion-text-color);
    }
  `,
})
export class FractionInputComponent {
  @Input() value: FractionValue = { num: '', den: '' };
  @Output() valueChange = new EventEmitter<FractionValue>();
  @Output() submitted = new EventEmitter<void>();

  change(part: keyof FractionValue, raw: string): void {
    this.value = { ...this.value, [part]: onlyDigits(raw) };
    this.valueChange.emit(this.value);
  }
}
