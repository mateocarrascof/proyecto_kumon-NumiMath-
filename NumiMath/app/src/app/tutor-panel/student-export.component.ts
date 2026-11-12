import { ChangeDetectorRef, Component, Input, inject } from '@angular/core';

import { ExportFailure, ExportPort } from '../core/export/export.port';

const MESSAGES: Record<ExportFailure, string> = {
  no_data: 'Todavía no hay datos para exportar.',
  pin: 'Tu PIN venció. Sal del panel y vuelve a entrar.',
  forbidden: 'No tienes acceso a este perfil.',
  network: 'No pude conectar con el servidor.',
  error: 'No pude preparar el archivo. Inténtalo en un momento.',
};

/** T22: "Exportar" el historial y las estadísticas del hijo seleccionado en CSV. */
@Component({
  selector: 'app-student-export',
  standalone: false,
  template: `
    <section aria-labelledby="h-export" class="history" data-testid="student-export">
      <h2 id="h-export">Exportar los datos de {{ nickname }}</h2>
      <p class="hint">
        Descarga el historial y las estadísticas en un archivo CSV (se abre en Excel o una hoja de
        cálculo). El archivo se guarda en tu dispositivo, no en nuestros servidores.
      </p>
      <ion-button fill="outline" [disabled]="busy" (click)="download()" data-testid="export-csv">
        {{ busy ? 'Preparando…' : 'Exportar (CSV)' }}
      </ion-button>
      @if (message) {
        <p [class]="done ? 'ok' : 'error'" [attr.role]="done ? 'status' : 'alert'" data-testid="export-message">
          {{ message }}
        </p>
      }
    </section>
  `,
})
export class StudentExportComponent {
  private readonly exporter = inject(ExportPort);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input({ required: true }) studentId = '';
  @Input() nickname = '';

  busy = false;
  done = false;
  message = '';

  async download(): Promise<void> {
    if (this.busy || !this.studentId) return;
    this.busy = true;
    this.message = '';
    const result = await this.exporter.downloadCsv(this.studentId);
    this.busy = false;
    this.done = result.ok;
    this.message = result.ok ? 'Listo: se descargó historial.csv.' : MESSAGES[result.reason];
    this.cdr.markForCheck();
  }
}
