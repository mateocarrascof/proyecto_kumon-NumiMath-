import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpOfflineSyncService, SYNC_REQUEST_TIMEOUT_MS } from './http-offline-sync.service';
import { QueuedAttempt } from './offline.model';
import { OfflineSyncError } from './offline-sync.port';

const URL = `${environment.apiUrl}/v1/students/perfil-1/offline-sync`;
const tick = () => new Promise((r) => setTimeout(r, 0));

const ATTEMPT: QueuedAttempt = {
  id: 'a-1', studentId: 'perfil-1', token: 'tok', topic: '2-06', level: 1, answer: 7,
  correct: true, answeredAt: '2026-11-12T10:00:00.000Z', localDate: '2026-11-12', durationS: 12,
  expiresAt: 2_000_000_000,
};

function setup(accessToken: string | null = 'jwt-del-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  return { service: TestBed.inject(HttpOfflineSyncService), http: TestBed.inject(HttpTestingController) };
}

describe('HttpOfflineSyncService (CU-A13)', () => {
  it('envía solo lo necesario (sin correct, level ni topic) con el JWT del tutor', async () => {
    const { service, http } = setup();
    const pending = service.send('perfil-1', [ATTEMPT]);
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-del-tutor');
    expect(req.request.body).toEqual({
      attempts: [
        {
          id: 'a-1', token: 'tok', answer: 7, answered_at: '2026-11-12T10:00:00.000Z',
          local_date: '2026-11-12', duration_s: 12,
        },
      ],
    });
    req.flush({ results: [{ id: 'a-1', status: 'accepted' }] });
    expect(await pending).toEqual([{ id: 'a-1', status: 'accepted' }]);
  });

  it('fracciones: manda el denominador', async () => {
    const { service, http } = setup();
    const pending = service.send('perfil-1', [{ ...ATTEMPT, answerDen: 4 }]);
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.body.attempts[0].answer_den).toBe(4);
    req.flush({ results: [] });
    await pending;
  });

  it.each([
    [403, 'forbidden'],
    [404, 'forbidden'],
    [401, 'retry'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
    [422, 'retry'],
  ])('traduce %i a %s', async (status, code) => {
    const { service, http } = setup();
    const pending = service.send('perfil-1', [ATTEMPT]);
    await tick();
    http.expectOne(URL).flush({ error: { code: 'x' } }, { status, statusText: 'x' });
    await expect(pending).rejects.toEqual(new OfflineSyncError(code as never));
  });

  it('sin red es "network"', async () => {
    const { service, http } = setup();
    const pending = service.send('perfil-1', [ATTEMPT]);
    await tick();
    http.expectOne(URL).error(new ProgressEvent('error'));
    await expect(pending).rejects.toEqual(new OfflineSyncError('network'));
  });

  it('una petición colgada vence a los 15 s y cuenta como sin red (se reintenta)', async () => {
    vi.useFakeTimers();
    try {
      const { service, http } = setup();
      const pending = service.send('perfil-1', [ATTEMPT]);
      const assertion = expect(pending).rejects.toEqual(new OfflineSyncError('network'));
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(URL); // queda sin responder
      await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin sesión no llama a la API (temporal)', async () => {
    const { service, http } = setup(null);
    await expect(service.send('perfil-1', [ATTEMPT])).rejects.toEqual(new OfflineSyncError('retry'));
    http.expectNone(URL);
  });

  it('una respuesta con forma rara no confirma nada', async () => {
    const { service, http } = setup();
    const pending = service.send('perfil-1', [ATTEMPT]);
    await tick();
    http.expectOne(URL).flush({ results: [{ id: 'a-1', status: 'quizas' }] });
    await expect(pending).rejects.toEqual(new OfflineSyncError('retry'));
  });
});
