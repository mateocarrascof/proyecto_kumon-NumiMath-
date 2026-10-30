// Copia los textos legales provisionales (fuente única: docs/legal-provisional) a src/assets/legal.
// Se copian BYTE A BYTE: la app verifica su huella SHA-256 contra la versión publicada en la base.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, '..', 'docs', 'legal-provisional');
const to = join(root, 'src', 'assets', 'legal');
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from).filter((n) => n.endsWith('.md'))) {
  copyFileSync(join(from, name), join(to, name));
}
console.log('Textos legales sincronizados en src/assets/legal');
