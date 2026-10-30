import { parseLegalText } from './legal-text';

describe('parseLegalText', () => {
  it('reconoce aviso, título, párrafo con negrita y nota', () => {
    const blocks = parseLegalText(
      '> **NO VÁLIDO LEGALMENTE.** Borrador.\n\n# Términos\n\n1. **Quién usa la app.** Un adulto.\n\n_Versión `x-1`._\n',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['banner', 'title', 'paragraph', 'note']);
    expect(blocks[0].runs[0]).toEqual({ text: 'NO VÁLIDO LEGALMENTE.', bold: true });
    expect(blocks[2].runs.some((r) => r.bold && r.text.includes('Quién'))).toBe(true);
    expect(blocks[3].runs[0].text).toBe('Versión x-1.');
  });

  it('no interpreta HTML: las etiquetas quedan como texto', () => {
    const [block] = parseLegalText('<script>alert(1)</script>');
    expect(block.runs[0].text).toBe('<script>alert(1)</script>');
  });
});
