export interface TextRun {
  text: string;
  bold: boolean;
}

export interface LegalBlock {
  kind: 'banner' | 'title' | 'paragraph' | 'note';
  runs: TextRun[];
}

function runs(line: string): TextRun[] {
  return line
    .split('**')
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((r) => r.text.length > 0);
}

/**
 * Convierte el subconjunto de Markdown de los textos legales a bloques. No genera HTML:
 * la plantilla pinta texto plano, así que un texto con etiquetas nunca se interpreta.
 */
export function parseLegalText(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) {
      blocks.push({ kind: 'banner', runs: runs(line.replace(/^>\s*/, '')) });
    } else if (line.startsWith('#')) {
      blocks.push({ kind: 'title', runs: runs(line.replace(/^#+\s*/, '')) });
    } else if (line.startsWith('_') && line.endsWith('_')) {
      blocks.push({ kind: 'note', runs: runs(line.replace(/^_+|_+$/g, '').replaceAll('`', '')) });
    } else {
      blocks.push({ kind: 'paragraph', runs: runs(line) });
    }
  }
  return blocks;
}
