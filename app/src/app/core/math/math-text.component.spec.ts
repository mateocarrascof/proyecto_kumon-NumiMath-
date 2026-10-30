import { mathSegments } from './math-text.component';
import { onlyDigits } from './fraction-input.component';

describe('mathSegments', () => {
  it('separa texto y fracciones', () => {
    expect(mathSegments('2/5 + 1/5 = ?')).toEqual([
      { kind: 'fraction', num: '2', den: '5' },
      { kind: 'text', value: ' + ' },
      { kind: 'fraction', num: '1', den: '5' },
      { kind: 'text', value: ' = ?' },
    ]);
  });

  it('un enunciado sin fracciones queda igual', () => {
    expect(mathSegments('7 + 5 = ?')).toEqual([{ kind: 'text', value: '7 + 5 = ?' }]);
    expect(mathSegments('')).toEqual([]);
  });
});

describe('onlyDigits', () => {
  it('deja solo dígitos, máximo 4', () => {
    expect(onlyDigits('1a2-3 45')).toBe('1234');
    expect(onlyDigits(null)).toBe('');
  });
});
