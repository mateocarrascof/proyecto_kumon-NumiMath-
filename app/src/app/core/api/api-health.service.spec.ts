import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { ApiHealthService } from './api-health.service';

describe('ApiHealthService', () => {
  let http: HttpTestingController;
  let service: ApiHealthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ApiHealthService);
  });

  it('devuelve ok cuando /healthz responde ok', async () => {
    const result = service.check();
    http.expectOne(`${environment.apiUrl}/healthz`).flush({ status: 'ok' });
    expect(await result).toBe('ok');
  });

  it('devuelve down ante un error de red', async () => {
    const result = service.check();
    http.expectOne(`${environment.apiUrl}/healthz`).error(new ProgressEvent('error'));
    expect(await result).toBe('down');
  });
});
