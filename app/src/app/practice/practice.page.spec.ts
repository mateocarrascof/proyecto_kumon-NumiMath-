import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { MascotComponent } from '../core/mascot/mascot.component';
import { MascotPort } from '../core/mascot/mascot.port';
import { MascotService } from '../core/mascot/mascot.service';
import { PracticeError, PracticePort } from '../core/practice/practice.port';
import { PracticePage } from './practice.page';

const TOPIC = { id: 'sumas_hasta_20', label: 'Sumas hasta 20' };
const EXERCISE = { token: 'tok', topic: TOPIC.id, text: '7 + 5 = ?', expiresIn: 600 };

function setup(overrides: Partial<PracticePort> = {}) {
  const port = {
    topics: vi.fn(async () => [TOPIC]),
    newExercise: vi.fn(async () => EXERCISE),
    answer: vi.fn(async () => ({ correct: true, correctAnswer: 12 })),
    ...overrides,
  };
  TestBed.configureTestingModule({
    declarations: [PracticePage, MascotComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: MascotPort, useExisting: MascotService },
      { provide: PracticePort, useValue: port },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'perfil-1' } } } },
    ],
  });
  return { page: TestBed.createComponent(PracticePage).componentInstance, port };
}

describe('PracticePage', () => {
  it('carga los temas del perfil', async () => {
    const { page, port } = setup();
    await page.ngOnInit();
    expect(port.topics).toHaveBeenCalledWith('perfil-1');
    expect(page.topics).toEqual([TOPIC]);
  });

  it('al elegir un tema pide un ejercicio', async () => {
    const { page, port } = setup();
    await page.ngOnInit();
    await page.choose(TOPIC);
    expect(port.newExercise).toHaveBeenCalledWith('perfil-1', TOPIC.id);
    expect(page.exercise?.text).toBe('7 + 5 = ?');
  });

  it('la respuesta solo admite dígitos', async () => {
    const { page } = setup();
    page.onAnswerInput('1a2-3 ');
    expect(page.answer).toBe('123');
    page.onAnswerInput('12345678901');
    expect(page.answer).toHaveLength(7);
  });

  it('una respuesta correcta suma, alegra a la mascota y no se puede enviar dos veces', async () => {
    const { page, port } = setup();
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('12');
    await page.submit();
    expect(port.answer).toHaveBeenCalledWith('perfil-1', 'tok', 12);
    expect(page.correctCount).toBe(1);
    expect(TestBed.inject(MascotPort).state()).toBe('happy');
    expect(page.canSubmit).toBe(false);
    await page.submit();
    expect(port.answer).toHaveBeenCalledTimes(1);
  });

  it('una respuesta incorrecta pone triste a la mascota pero no suma', async () => {
    const { page } = setup({
      answer: vi.fn(async () => ({ correct: false, correctAnswer: 12 })),
    });
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('11');
    await page.submit();
    expect(page.correctCount).toBe(0);
    expect(page.total).toBe(1);
    expect(TestBed.inject(MascotPort).state()).toBe('sad');
  });

  it('si el ejercicio venció, avisa y pide otro automáticamente', async () => {
    const { page, port } = setup({
      answer: vi.fn(async () => {
        throw new PracticeError('expired');
      }),
    });
    await page.ngOnInit();
    await page.choose(TOPIC);
    page.onAnswerInput('12');
    await page.submit();
    expect(port.newExercise).toHaveBeenCalledTimes(2);
  });

  it('si no hay red, muestra un mensaje amable', async () => {
    const { page } = setup({
      topics: vi.fn(async () => {
        throw new PracticeError('network');
      }),
    });
    await page.ngOnInit();
    expect(page.error).toContain('No pude conectar');
    expect(page.loading).toBe(false);
  });
});
