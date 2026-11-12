import { TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular/lazy';

import { ExportPort, ExportResult } from '../core/export/export.port';
import { StudentExportComponent } from './student-export.component';

function setup(result: ExportResult) {
  const downloadCsv = vi.fn(async () => result);
  TestBed.configureTestingModule({
    declarations: [StudentExportComponent],
    imports: [IonicModule.forRoot()],
    providers: [{ provide: ExportPort, useValue: { downloadCsv } }],
  });
  const fixture = TestBed.createComponent(StudentExportComponent);
  fixture.componentInstance.studentId = 'perfil-1';
  fixture.componentInstance.nickname = 'Ana';
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance, downloadCsv, el: fixture.nativeElement as HTMLElement };
}

describe('StudentExportComponent (T22)', () => {
  it('descarga y avisa con suavidad que se guardó en el dispositivo', async () => {
    const t = setup({ ok: true });
    (t.el.querySelector('[data-testid="export-csv"]') as HTMLElement).click();
    await Promise.resolve();
    await t.c.download();
    t.fixture.detectChanges();
    expect(t.downloadCsv).toHaveBeenCalledWith('perfil-1');
    expect(t.el.querySelector('[data-testid="export-message"]')?.textContent).toContain('historial.csv');
    expect(t.el.textContent).toContain('no en nuestros servidores');
  });

  it('sin datos lo informa', async () => {
    const t = setup({ ok: false, reason: 'no_data' });
    await t.c.download();
    t.fixture.detectChanges();
    const msg = t.el.querySelector('[data-testid="export-message"]');
    expect(msg?.textContent).toContain('Todavía no hay datos para exportar');
    expect(msg?.getAttribute('role')).toBe('alert');
  });

  it('con el PIN vencido lo dice', async () => {
    const t = setup({ ok: false, reason: 'pin' });
    await t.c.download();
    expect(t.c.message).toContain('PIN venció');
  });

  it('no pide dos descargas a la vez', async () => {
    const t = setup({ ok: true });
    const first = t.c.download();
    const second = t.c.download();
    await Promise.all([first, second]);
    expect(t.downloadCsv).toHaveBeenCalledTimes(1);
  });
});
