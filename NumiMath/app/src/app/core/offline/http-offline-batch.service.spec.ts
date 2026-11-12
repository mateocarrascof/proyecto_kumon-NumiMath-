import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpOfflineBatchService } from './http-offline-batch.service';
import { OfflineBatchError } from './offline-batch.port';

const URL = `${environment.apiUrl}/v1/students/perfil-1/offline-batch`;
const tick = () => new Promise((r) => setTimeout(r, 0));

const BODY = {
  salt: 'sal',
  issued_at: 1000,
  expires_at: 2000,
  topics: [
    {
      id: '3-06', label: 'Sumas hasta 1 000', module: 'Números y operaciones', grade: 3,
      level: 2, block_done: 4, block_correct: 3, block_size: 10, mastered: false,
    },
  ],
  exercises: [
    { token: 'tok', topic: '3-06', level: 2, text: '481 + 155 = ?', answer_kind: 'integer', solution_hash: 'h' },
  ],
};

function setup(accessToken: string | null = 'jwt-del-tutor') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  return {
    service: TestBed.inject(HttpOfflineBatchService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpOfflineBatchService (CU-A12)', () => {
  it('pide el lote con el JWT del tutor y lo traduce (ejercicios sin usar)', async () => {
    const { service, http } = setup();
    const pending = service.download('perfil-1');
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-del-tutor');
    req.flush(BODY);
    const batch = await pending;
    expect(batch).toMatchObject({ studentId: 'perfil-1', salt: 'sal', issuedAt: 1000, expiresAt: 2000 });
    expect(batch.topics[0]).toMatchObject({ level: 2, blockDone: 4, blockCorrect: 3 });
    // Los miles no se parten entre dos líneas (igual que en la práctica en línea).
    expect(batch.topics[0].label).toBe('Sumas hasta 1 000');
    expect(batch.exercises[0]).toEqual({
      token: 'tok', topic: '3-06', level: 2, text: '481 + 155 = ?', answerKind: 'integer',
      solutionHash: 'h', used: false,
    });
    http.verify();
  });

  it('sin sesión no llama a la API', async () => {
    const { service, http } = setup(null);
    await expect(service.download('perfil-1')).rejects.toEqual(new OfflineBatchError('session'));
    http.expectNone(URL);
  });

  it.each([
    [403, 'forbidden'],
    [429, 'limit'],
    [401, 'session'],
    [503, 'unavailable'],
  ])('traduce %i a %s', async (status, code) => {
    const { service, http } = setup();
    const pending = service.download('perfil-1');
    await tick();
    http.expectOne(URL).flush({ error: { code: 'x' } }, { status, statusText: 'x' });
    await expect(pending).rejects.toEqual(new OfflineBatchError(code as never));
  });

  it('sin red es "network"', async () => {
    const { service, http } = setup();
    const pending = service.download('perfil-1');
    await tick();
    http.expectOne(URL).error(new ProgressEvent('error'));
    await expect(pending).rejects.toEqual(new OfflineBatchError('network'));
  });

  it('un lote con forma rara no se acepta (falla cerrado)', async () => {
    const { service, http } = setup();
    const pending = service.download('perfil-1');
    await tick();
    http.expectOne(URL).flush({ salt: 'sal', topics: 'x' });
    await expect(pending).rejects.toEqual(new OfflineBatchError('unavailable'));
  });
});
