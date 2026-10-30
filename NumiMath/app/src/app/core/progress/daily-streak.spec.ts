import { dailyStreakHint, daysLabel } from './daily-streak';

describe('racha diaria: textos', () => {
  it('usa singular y plural', () => {
    expect(daysLabel(1)).toBe('1 día seguido');
    expect(daysLabel(4)).toBe('4 días seguidos');
  });

  it('anima sin hablar de perder la racha', () => {
    expect(dailyStreakHint(3, true)).toBe('');
    expect(dailyStreakHint(3, false)).toContain('seguir sumando');
    expect(dailyStreakHint(0, false)).toContain('empezar');
    for (const text of [dailyStreakHint(3, false), dailyStreakHint(0, false)]) {
      expect(text.toLowerCase()).not.toMatch(/perd|perdiste|pierdes/);
    }
  });
});
