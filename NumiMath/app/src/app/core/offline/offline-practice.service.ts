import { Injectable, inject } from '@angular/core';

import { AnswerResult, Exercise, Topic } from '../practice/practice.port';
import { localDay } from '../time/local-day';
import { MAX_DURATION_S, OfflineBatch, OfflineExercise, QueuedAttempt } from './offline.model';
import { applyAnswer, matches, simplified } from './offline-grading';
import { OfflineBatchError, OfflineBatchPort } from './offline-batch.port';
import { OfflineStore } from './offline-store.port';

/** Se pide un lote nuevo si al actual le quedan menos de 2 días (ADR 0002, sección 3). */
const REFRESH_BEFORE_S = 2 * 24 * 3600;

/**
 * `no_batch`: no hay lote (o venció): hace falta conectarse una vez. `exhausted`: se acabaron
 * los ejercicios guardados de esa habilidad (excepción de la ficha CU-A12). `storage`: no se
 * pudo guardar en el dispositivo (el resultado NO se muestra).
 */
export type OfflineErrorCode = 'no_batch' | 'exhausted' | 'storage';

export class OfflineError extends Error {
  constructor(readonly code: OfflineErrorCode) {
    super(code);
  }
}

/**
 * Práctica sin conexión con el lote descargado (CU-A12). La corrección es PROVISIONAL: lo que
 * cuenta lo recalcula el servidor al sincronizar (CU-A13, otro encargo). Aquí los intentos solo
 * quedan en la cola local.
 */
@Injectable({ providedIn: 'root' })
export class OfflinePracticeService {
  private readonly store = inject(OfflineStore);
  private readonly batches = inject(OfflineBatchPort);
  /** Cuándo se mostró cada ejercicio, para medir el tiempo (solo en memoria). */
  private readonly shownAt = new Map<string, number>();

  /** Reloj en milisegundos (las pruebas lo cambian). */
  now: () => number = () => Date.now();

  private nowS(): number {
    return Math.floor(this.now() / 1000);
  }

  private usable(batch: OfflineBatch, exercise: OfflineExercise): boolean {
    return !exercise.used && batch.expiresAt > this.nowS();
  }

  private needsRefresh(batch: OfflineBatch): boolean {
    if (batch.expiresAt - this.nowS() < REFRESH_BEFORE_S) return true;
    const left = batch.exercises.filter((e) => this.usable(batch, e)).length;
    return left * 2 < batch.exercises.length;
  }

  /**
   * Con conexión: descarga un lote si no hay, si quedan menos de la mitad o si vence en menos de
   * 2 días. Mejor esfuerzo: si falla, la práctica en línea sigue igual. Si el servidor dice que
   * el perfil ya no se puede usar (403), se borran sus datos del dispositivo.
   */
  async refresh(studentId: string): Promise<void> {
    await this.store.purgeExpired(this.nowS()).catch(() => undefined);
    const current = await this.store.batch(studentId).catch(() => null);
    if (current && !this.needsRefresh(current)) return;
    try {
      await this.store.saveBatch(await this.batches.download(studentId));
    } catch (error) {
      if (error instanceof OfflineBatchError && error.code === 'forbidden') {
        await this.store.forgetStudent(studentId).catch(() => undefined);
      }
    }
  }

  private async activeBatch(studentId: string): Promise<OfflineBatch> {
    let batch: OfflineBatch | null;
    try {
      batch = await this.store.batch(studentId);
    } catch {
      throw new OfflineError('no_batch');
    }
    if (!batch || batch.expiresAt <= this.nowS()) throw new OfflineError('no_batch');
    return batch;
  }

  /** Habilidades del lote, con el nivel y el bloque que lleva el dispositivo. Sin repaso. */
  async topics(studentId: string): Promise<Topic[]> {
    const batch = await this.activeBatch(studentId);
    return batch.topics.map((t) => ({
      id: t.id,
      label: t.label,
      module: t.module,
      grade: t.grade,
      review: false,
      level: t.level,
      blockDone: t.blockDone,
      blockSize: t.blockSize,
      mastered: t.mastered,
      // Sin conexión no hay diagnóstico inicial (necesita al servidor para guardarse).
      diagnosticAvailable: false,
      exhausted: !batch.exercises.some(
        (e) => e.topic === t.id && e.level === t.level && this.usable(batch, e),
      ),
    }));
  }

  /** Siguiente ejercicio guardado de la habilidad, en el nivel que lleva el dispositivo. */
  async next(studentId: string, topicId: string): Promise<Exercise> {
    const batch = await this.activeBatch(studentId);
    const topic = batch.topics.find((t) => t.id === topicId);
    const exercise =
      topic &&
      batch.exercises.find(
        (e) => e.topic === topicId && e.level === topic.level && this.usable(batch, e),
      );
    if (!topic || !exercise) throw new OfflineError('exhausted');
    this.shownAt.set(exercise.token, this.now());
    return {
      token: exercise.token,
      topic: exercise.topic,
      text: exercise.text,
      level: exercise.level,
      expiresIn: batch.expiresAt - this.nowS(),
      answerKind: exercise.answerKind,
      blockDone: topic.blockDone,
      blockSize: topic.blockSize,
      mastered: topic.mastered,
      offline: true,
    };
  }

  /**
   * Corrige con la solución guardada y deja el intento en la cola. La promesa se cumple SOLO
   * cuando el intento quedó escrito en el dispositivo (RNF-06): antes no hay resultado que
   * mostrar. Si no se pudo guardar, falla con `storage` y la pantalla no confirma nada.
   */
  async answer(
    studentId: string,
    token: string,
    answer: number,
    answerDen?: number,
  ): Promise<AnswerResult> {
    const batch = await this.activeBatch(studentId);
    const exercise = batch.exercises.find((e) => e.token === token);
    if (!exercise || !this.usable(batch, exercise)) throw new OfflineError('exhausted');
    const topic = batch.topics.find((t) => t.id === exercise.topic);
    if (!topic) throw new OfflineError('exhausted');

    const correct = await matches(batch.salt, exercise.solutionHash, answer, answerDen);
    const shown = this.shownAt.get(token);
    const seconds = shown === undefined ? null : Math.round((this.now() - shown) / 1000);

    // Copia del lote con el ejercicio usado y el bloque actualizado: se guarda junto al intento.
    const updated: OfflineBatch = JSON.parse(JSON.stringify(batch));
    updated.exercises.find((e) => e.token === token)!.used = true;
    const t = updated.topics.find((x) => x.id === topic.id)!;
    Object.assign(t, applyAnswer(t, exercise.level, correct));

    const attempt: QueuedAttempt = {
      id: crypto.randomUUID(),
      studentId,
      token,
      topic: exercise.topic,
      level: exercise.level,
      answer,
      ...(answerDen === undefined ? {} : { answerDen }),
      correct,
      answeredAt: new Date(this.now()).toISOString(),
      localDate: localDay(new Date(this.now())),
      // Medido en el dispositivo: no es verificable, solo informativo. Tope de 600 s; más que
      // eso (o un reloj que fue hacia atrás) se guarda sin tiempo, como en línea.
      durationS: seconds !== null && seconds >= 0 && seconds <= MAX_DURATION_S ? seconds : null,
      expiresAt: batch.expiresAt,
    };
    try {
      await this.store.recordAttempt(updated, attempt);
    } catch {
      throw new OfflineError('storage');
    }
    this.shownAt.delete(token);

    const result: AnswerResult = { correct, offline: true };
    if (correct && answerDen !== undefined) {
      const simple = simplified(answer, answerDen);
      if (simple) result.simplified = simple;
    }
    return result;
  }
}
