import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('muestra segundos y minutos para el adulto', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(35)).toBe('35 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(80)).toBe('1 min 20 s');
    expect(formatDuration(600)).toBe('10 min');
  });
});
