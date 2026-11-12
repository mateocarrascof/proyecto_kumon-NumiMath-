import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { ParentalSession } from '../parental/parental-session';
import { HttpExportService } from './http-export.service';

const URL_CSV = `${environment.apiUrl}/v1/students/perfil-1/export.csv`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(accessToken: string | null = 'sesion-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  TestBed.inject(ParentalSession).start('token-del-pin', 600);
  return { service: TestBed.inject(HttpExportService), http: TestBed.inject(HttpTestingController) };
}

describe('HttpExportService (T22)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pide el CSV con la sesión y el PIN y lo ofrece como descarga con un Blob', async () => {
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { service, http } = setup();
    const result = service.downloadCsv('perfil-1');
    await tick();
    const req = http.expectOne(URL_CSV);
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    expect(req.request.headers.get('Authorization')).toBe('Bearer sesion-tutor');
    expect(req.request.headers.get('X-Parental-Token')).toBe('token-del-pin');
    req.flush(new Blob(['a,b'], { type: 'text/csv' }));
    expect(await result).toEqual({ ok: true });
    expect(createUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    await tick();
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
    expect(document.querySelector('a[download]')).toBeNull(); // no deja el enlace en la página
    vi.unstubAllGlobals();
  });

  it.each([
    [404, 'no_data', 'no_data'],
    [401, 'parental_required', 'pin'],
    [403, 'forbidden', 'forbidden'],
    [503, 'service_unavailable', 'error'],
  ])('un %i (%s) se traduce a %s sin descargar nada', async (status, code, reason) => {
    const createUrl = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const { service, http } = setup();
    const result = service.downloadCsv('perfil-1');
    await tick();
    http
      .expectOne(URL_CSV)
      .flush(new Blob([JSON.stringify({ error: { code } })], { type: 'application/json' }), {
        status,
        statusText: 'x',
      });
    expect(await result).toEqual({ ok: false, reason });
    expect(createUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.downloadCsv('perfil-1')).toEqual({ ok: false, reason: 'forbidden' });
    http.expectNone(URL_CSV);
  });
});
