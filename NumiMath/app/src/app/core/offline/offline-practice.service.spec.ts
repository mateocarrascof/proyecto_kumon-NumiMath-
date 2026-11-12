import { TestBed } from '@angular/core/testing';

import { MemoryOfflineStore } from './memory-offline-store';
import { OfflineBatch, QueuedAttempt } from './offline.model';
import { OfflineBatchError, OfflineBatchPort } from './offline-batch.port';
import { solutionHash } from './offline-grading';
import { OfflineError, OfflinePracticeService } from './offline-practice.service';
import { OfflineStore } from './offline-store.port';

const NOW = Date.UTC(2026, 10, 12, 15, 0, 0);
const NOW_S = NOW / 1000;
const DAY = 24 * 3600;
const ID = 'perfil-1';

/** Lote de prueba: `n` ejercicios de "2-06" en nivel 1 ("k + 1 = ?", respuesta k + 1). */
async function makeBatch(n = 3, expiresIn = 7 * DAY): Promise<OfflineBatch> {
  const exercises = [];
  for (let k = 0; k < n; k++) {
    exercises.push({
      token: `tok-${k}`,
      topic: '2-06',
      level: 1 as const,
      text: `${k} + 1 = ?`,
      answerKind: 'integer' as const,
      solutionHash: await solutionHash('sal', String(k + 1)),
      used: false,
    });
  }
  return {
    studentId: ID,
    salt: 'sal',
    issuedAt: NOW_S,
    expiresAt: NOW_S + expiresIn,
    topics: [
      {
        id: '2-06',
        label: 'Sumas',
        module: 'Números y operaciones',
        grade: 2,
        level: 1,
        blockDone: 0,
        blockCorrect: 0,
        blockSize: 10,
        mastered: false,
      },
    ],
    exercises,
  };
}

function setup(download: () => Promise<OfflineBatch> = async () => makeBatch(), store = new MemoryOfflineStore()) {
  const port = { download: vi.fn(download) };
  TestBed.configureTestingModule({
    providers: [
      { provide: OfflineStore, useValue: store },
      { provide: OfflineBatchPort, useValue: port },
    ],
  });
  const service = TestBed.inject(OfflinePracticeService);
  let clock = NOW;
  service.now = () => clock;
  return { service, store, port, tick: (ms: number) => (clock += ms) };
}

describe('OfflinePracticeService (CU-A12)', () => {
  it('sin lote: avisa que hace falta conectarse', async () => {
    const { service } = setup();
    await expect(service.topics(ID)).rejects.toEqual(new OfflineError('no_batch'));
  });

  it('un lote vencido no se usa', async () => {
    const { service, store, tick } = setup();
    await store.saveBatch(await makeBatch(3, 60));
    tick(61_000);
    await expect(service.topics(ID)).rejects.toEqual(new OfflineError('no_batch'));
  });

  it('entrega ejercicios del lote en el nivel que lleva el dispositivo, sin diagnóstico', async () => {
    const { service, store } = setup();
    await store.saveBatch(await makeBatch());
    const [topic] = await service.topics(ID);
    expect(topic).toMatchObject({ id: '2-06', level: 1, exhausted: false, diagnosticAvailable: false });
    const exercise = await service.next(ID, '2-06');
    expect(exercise).toMatchObject({ token: 'tok-0', text: '0 + 1 = ?', offline: true, level: 1 });
  });

  it('corrige con la solución guardada y deja el intento en la cola', async () => {
    const { service, store, tick } = setup();
    await store.saveBatch(await makeBatch());
    await service.next(ID, '2-06');
    tick(42_000);
    const result = await service.answer(ID, 'tok-0', 1);
    expect(result).toEqual({ correct: true, offline: true });
    const [attempt] = await store.queue(ID);
    expect(attempt).toMatchObject({
      studentId: ID,
      token: 'tok-0',
      topic: '2-06',
      level: 1,
      answer: 1,
      correct: true,
      durationS: 42,
      localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    // El ejercicio quedó usado y el bloque avanzó, en el mismo guardado.
    const saved = (await store.batch(ID))!;
    expect(saved.exercises[0].used).toBe(true);
    expect(saved.topics[0]).toMatchObject({ blockDone: 1, blockCorrect: 1 });
    // Una respuesta distinta es "casi", y no revela la solución.
    await service.next(ID, '2-06');
    const wrong = await service.answer(ID, 'tok-1', 99);
    expect(wrong).toEqual({ correct: false, offline: true });
    expect(wrong.correctAnswer).toBeUndefined();
  });

  it('el tiempo tiene tope de 600 s: más que eso se guarda sin tiempo', async () => {
    const { service, store, tick } = setup();
    await store.saveBatch(await makeBatch());
    await service.next(ID, '2-06');
    tick(601_000);
    await service.answer(ID, 'tok-0', 1);
    expect((await store.queue(ID))[0].durationS).toBeNull();
  });

  it('el intento se guarda ANTES de devolver el resultado (RNF-06)', async () => {
    const store = new MemoryOfflineStore();
    let release!: () => void;
    const original = store.recordAttempt.bind(store);
    store.recordAttempt = (b: OfflineBatch, a: QueuedAttempt) =>
      new Promise<void>((resolve) => {
        release = () => void original(b, a).then(resolve);
      });
    const { service } = setup(undefined, store);
    await store.saveBatch(await makeBatch());
    await service.next(ID, '2-06');
    let shown = false;
    const pending = service.answer(ID, 'tok-0', 1).then(() => (shown = true));
    // Espera a que empiece el guardado (el hash con crypto.subtle es asíncrono).
    for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 0));
    expect(shown).toBe(false);
    expect(store.attempts).toHaveLength(0);
    release();
    await pending;
    expect(shown).toBe(true);
    expect(store.attempts).toHaveLength(1);
  });

  it('si no se pudo guardar, no hay resultado y el ejercicio sigue disponible', async () => {
    const store = new MemoryOfflineStore();
    const { service } = setup(undefined, store);
    await store.saveBatch(await makeBatch());
    await service.next(ID, '2-06');
    store.failWrites = new Error('quota');
    await expect(service.answer(ID, 'tok-0', 1)).rejects.toEqual(new OfflineError('storage'));
    expect(store.attempts).toHaveLength(0);
    expect((await store.batch(ID))!.exercises[0].used).toBe(false);
  });

  it('un ejercicio ya usado no se puede responder dos veces', async () => {
    const { service, store } = setup();
    await store.saveBatch(await makeBatch());
    await service.next(ID, '2-06');
    await service.answer(ID, 'tok-0', 1);
    await expect(service.answer(ID, 'tok-0', 1)).rejects.toEqual(new OfflineError('exhausted'));
    expect(await store.queue(ID)).toHaveLength(1);
  });

  it('lote agotado: el tema queda marcado y pedir otro avisa (excepción de la ficha)', async () => {
    const { service, store } = setup();
    await store.saveBatch(await makeBatch(2));
    for (const token of ['tok-0', 'tok-1']) {
      await service.next(ID, '2-06');
      await service.answer(ID, token, 0);
    }
    expect((await service.topics(ID))[0].exhausted).toBe(true);
    await expect(service.next(ID, '2-06')).rejects.toEqual(new OfflineError('exhausted'));
  });

  describe('manipulación del lote local', () => {
    it('cambiar la solución guardada solo cambia lo que se ve: la cola guarda la respuesta real y el token intacto', async () => {
      const { service, store } = setup();
      const batch = await makeBatch();
      // Alguien edita el almacenamiento para que "99" sea la solución.
      batch.exercises[0].solutionHash = await solutionHash('sal', '99');
      await store.saveBatch(batch);
      await service.next(ID, '2-06');
      const result = await service.answer(ID, 'tok-0', 99);
      expect(result.correct).toBe(true); // provisional, solo en pantalla
      const [attempt] = await store.queue(ID);
      // Lo que se enviará al servidor (CU-A13): el token firmado sin tocar y la respuesta escrita.
      // El servidor regenera la respuesta desde el token y vuelve a corregir: "99" no vale.
      expect(attempt.token).toBe('tok-0');
      expect(attempt.answer).toBe(99);
    });

    it('cambiar el nivel guardado de un ejercicio no cambia el token que se envía', async () => {
      const { service, store } = setup();
      const batch = await makeBatch();
      batch.topics[0].level = 3;
      batch.exercises[0].level = 3;
      await store.saveBatch(batch);
      await service.next(ID, '2-06');
      await service.answer(ID, 'tok-0', 1);
      // El nivel real va firmado DENTRO del token; el servidor usa ese, no el de la cola.
      expect((await store.queue(ID))[0].token).toBe('tok-0');
    });

    it('lo guardado no se puede alterar por referencia desde la pantalla', async () => {
      const { service, store } = setup();
      await store.saveBatch(await makeBatch());
      const exercise = await service.next(ID, '2-06');
      exercise.token = 'otro';
      exercise.level = 3;
      expect((await store.batch(ID))!.exercises[0]).toMatchObject({ token: 'tok-0', level: 1 });
    });
  });

  describe('descarga del lote', () => {
    it('sin lote, descarga y guarda uno', async () => {
      const { service, store, port } = setup();
      await service.refresh(ID);
      expect(port.download).toHaveBeenCalledWith(ID);
      expect((await store.batch(ID))?.exercises).toHaveLength(3);
    });

    it('con un lote vigente y casi completo no descarga otro', async () => {
      const { service, store, port } = setup();
      await store.saveBatch(await makeBatch(4));
      await service.refresh(ID);
      expect(port.download).not.toHaveBeenCalled();
    });

    it('renueva si quedan menos de la mitad o vence en menos de 2 días', async () => {
      const used = setup();
      const batch = await makeBatch(4);
      batch.exercises.slice(0, 3).forEach((e) => (e.used = true));
      await used.store.saveBatch(batch);
      await used.service.refresh(ID);
      expect(used.port.download).toHaveBeenCalledTimes(1);

      TestBed.resetTestingModule();
      const soon = setup();
      await soon.store.saveBatch(await makeBatch(4, DAY));
      await soon.service.refresh(ID);
      expect(soon.port.download).toHaveBeenCalledTimes(1);
    });

    it('si el perfil ya no se puede usar (403), borra su lote, cola y copia local', async () => {
      const store = new MemoryOfflineStore();
      const { service } = setup(async () => {
        throw new OfflineBatchError('forbidden');
      }, store);
      const old = await makeBatch(4, DAY);
      await store.saveBatch(old);
      await store.saveProfiles([{ id: ID, nickname: 'Ana', grade: 2, blocked: false }]);
      store.attempts.push({
        id: 'a1', studentId: ID, token: 't', topic: '2-06', level: 1, answer: 1, correct: true,
        answeredAt: '', localDate: '2026-11-12', durationS: null, expiresAt: old.expiresAt,
      });
      await service.refresh(ID);
      expect(await store.batch(ID)).toBeNull();
      expect(await store.queue(ID)).toEqual([]);
      expect(await store.profiles()).toEqual([]);
    });

    it('otras fallas (sin red, límite diario) conservan lo que había', async () => {
      const store = new MemoryOfflineStore();
      const { service } = setup(async () => {
        throw new OfflineBatchError('limit');
      }, store);
      await store.saveBatch(await makeBatch(4, DAY));
      await service.refresh(ID);
      expect(await store.batch(ID)).not.toBeNull();
    });

    it('purga intentos cuyo plazo para sincronizar (caducidad + 14 días) ya pasó', async () => {
      const store = new MemoryOfflineStore();
      const { service } = setup(undefined, store);
      const base = {
        studentId: ID, token: 't', topic: '2-06', level: 1 as const, answer: 1, correct: true,
        answeredAt: '', localDate: '2026-11-01', durationS: null,
      };
      store.attempts.push({ ...base, id: 'viejo', expiresAt: NOW_S - 14 * DAY });
      store.attempts.push({ ...base, id: 'vigente', expiresAt: NOW_S - 13 * DAY });
      await service.refresh(ID);
      expect((await store.queue(ID)).map((a) => a.id)).toEqual(['vigente']);
    });
  });
});
