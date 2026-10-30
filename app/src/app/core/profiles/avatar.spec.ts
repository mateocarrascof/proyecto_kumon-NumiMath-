import { AVATARS, AVATAR_TONES, avatarFor } from './avatar';

describe('avatarFor', () => {
  it('siempre da el mismo animalito para el mismo perfil', () => {
    const id = '11111111-aaaa-0000-0000-000000000001';
    expect(avatarFor(id)).toEqual(avatarFor(id));
  });

  it('usa solo animalitos y colores de la lista', () => {
    for (let i = 0; i < 200; i++) {
      const a = avatarFor(`perfil-${i}`);
      expect(AVATARS).toContain(a.emoji);
      expect(AVATAR_TONES).toContain(a.tone);
    }
  });

  it('reparte animalitos distintos entre perfiles', () => {
    const emojis = new Set(Array.from({ length: 60 }, (_, i) => avatarFor(`id-${i}`).emoji));
    expect(emojis.size).toBeGreaterThan(6);
  });
});
