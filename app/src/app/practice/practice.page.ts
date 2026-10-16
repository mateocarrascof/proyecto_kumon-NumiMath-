import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { MascotPort } from '../core/mascot/mascot.port';
import {
  AnswerResult,
  Exercise,
  PracticeError,
  PracticePort,
  Topic,
} from '../core/practice/practice.port';

const ERRORS: Record<string, string> = {
  expired: 'Ese ejercicio ya venció. Te doy otro.',
  already_answered: 'Ese ejercicio ya estaba respondido. Te doy otro.',
  session: 'Tu sesión no es válida, vuelve a iniciar sesión.',
  forbidden: 'No tienes acceso a este perfil. Vuelve a Perfiles e inténtalo de nuevo.',
  unavailable: 'No pude verificar el acceso. Inténtalo en un momento.',
  network: 'No pude conectar con el servidor. ¿Está encendido?',
};

@Component({
  selector: 'app-practice',
  templateUrl: 'practice.page.html',
  styleUrls: ['practice.page.scss'],
  standalone: false,
})
export class PracticePage implements OnInit {
  private readonly practice = inject(PracticePort);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly mascot = inject(MascotPort);

  studentId = '';
  topics: Topic[] = [];
  topic: Topic | null = null;
  exercise: Exercise | null = null;
  result: AnswerResult | null = null;
  answer = '';
  busy = false;
  loading = true;
  error = '';
  correctCount = 0;
  total = 0;

  async ngOnInit(): Promise<void> {
    this.studentId = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      this.topics = await this.practice.topics(this.studentId);
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async choose(topic: Topic): Promise<void> {
    this.topic = topic;
    this.correctCount = 0;
    this.total = 0;
    await this.next();
  }

  async next(): Promise<void> {
    if (!this.topic || this.busy) return;
    this.busy = true;
    this.error = '';
    this.result = null;
    this.answer = '';
    this.mascot.set('thinking');
    try {
      this.exercise = await this.practice.newExercise(this.studentId, this.topic.id);
      this.mascot.set('idle');
    } catch (error) {
      this.exercise = null;
      this.fail(error);
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  onAnswerInput(value: string | null | undefined): void {
    // Solo dígitos: la respuesta es un número, nunca texto libre.
    this.answer = (value ?? '').replace(/\D/g, '').slice(0, 7);
  }

  get canSubmit(): boolean {
    return !!this.exercise && !this.result && !this.busy && this.answer.length > 0;
  }

  async submit(): Promise<void> {
    if (!this.exercise || !this.canSubmit) return;
    this.busy = true;
    this.error = '';
    try {
      this.result = await this.practice.answer(
        this.studentId,
        this.exercise.token,
        Number(this.answer),
      );
      this.total += 1;
      if (this.result.correct) this.correctCount += 1;
      this.mascot.set(this.result.correct ? 'happy' : 'sad');
    } catch (error) {
      this.fail(error);
      if (
        error instanceof PracticeError &&
        (error.code === 'expired' || error.code === 'already_answered')
      ) {
        this.busy = false;
        await this.next();
        return;
      }
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  changeTopic(): void {
    this.topic = null;
    this.exercise = null;
    this.result = null;
    this.mascot.set('idle');
  }

  private fail(error: unknown): void {
    const code = error instanceof PracticeError ? error.code : 'unavailable';
    this.error = ERRORS[code];
    this.mascot.set('sad');
  }
}
