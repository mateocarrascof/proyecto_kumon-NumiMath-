import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { localDay } from '../time/local-day';
import { HttpProgressService } from './http-progress.service';

const URL = `${environment.apiUrl}/v1/students/perfil-1/progress`;

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => 'jwt-del-tutor' } },
    ],
  });
  return {
    service: TestBed.inject(HttpProgressService),
    http: TestBed.inject(HttpTestingController),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('HttpProgressService', () => {
  it('manda la fecha local y mapea la racha diaria', async () => {
    const { service, http } = setup();
    const result = service.get('perfil-1');
    await tick();
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('today')).toBe(localDay());
    req.flush({
      total: 1,
      correct: 1,
      streak: 1,
      daily_streak: 3,
      practiced_today: true,
      by_topic: [],
      recent: [],
    });
    const progress = await result;
    expect(progress.dailyStreak).toBe(3);
    expect(progress.practicedToday).toBe(true);
  });
});

describe('HttpProgressService: evolución (CU-A23)', () => {
  it('mapea las semanas de la evolución', async () => {
    const { service, http } = setup();
    const result = service.get('perfil-1');
    await tick();
    http.expectOne((r) => r.url === URL).flush({
      total: 3,
      correct: 2,
      streak: 0,
      daily_streak: 0,
      practiced_today: false,
      by_topic: [],
      recent: [],
      weeks: [
        { start: '2026-10-01', total: 0, correct: 0 },
        { start: '2026-10-08', total: 3, correct: 2 },
      ],
    });
    expect((await result).weeks).toEqual([
      { start: '2026-10-01', total: 0, correct: 0 },
      { start: '2026-10-08', total: 3, correct: 2 },
    ]);
  });

  it('si la API aún no envía semanas, deja la lista vacía', async () => {
    const { service, http } = setup();
    const result = service.get('perfil-1');
    await tick();
    http.expectOne((r) => r.url === URL).flush({
      total: 0,
      correct: 0,
      streak: 0,
      daily_streak: 0,
      practiced_today: false,
      by_topic: [],
      recent: [],
    });
    expect((await result).weeks).toEqual([]);
  });
});
