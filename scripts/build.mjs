// build.mjs — assemble dist/ for GitHub Pages: site files + fresh data/.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });
for (const f of ['index.html', 'app.js']) cpSync(join(ROOT, f), join(DIST, f));
for (const f of ['tempo.json', 'base.json', 'meta.json']) {
  if (existsSync(join(ROOT, 'data', f))) cpSync(join(ROOT, 'data', f), join(DIST, 'data', f));
}
console.log('dist/ built');
