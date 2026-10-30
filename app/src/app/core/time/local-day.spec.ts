import { localDay } from './local-day';

describe('localDay', () => {
  it('formatea la fecha local con ceros a la izquierda', () => {
    expect(localDay(new Date(2026, 0, 5, 10, 0))).toBe('2026-01-05');
  });

  it('usa la hora local también cerca de la medianoche', () => {
    expect(localDay(new Date(2026, 9, 26, 23, 59))).toBe('2026-10-26');
    expect(localDay(new Date(2026, 9, 27, 0, 1))).toBe('2026-10-27');
  });
});
