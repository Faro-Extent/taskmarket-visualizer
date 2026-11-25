// deploy.mjs — one-command deploy: build dist/, commit + push to main.
// The GitHub Actions workflow (update-data.yml) then publishes to GitHub Pages.
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
run('node scripts/build.mjs');
run('git add -A');
try {
  run(`git commit -m "deploy: ${new Date().toISOString()}"`);
} catch {
  console.log('nothing new to commit');
}
run('git push origin main');
console.log('pushed — GitHub Actions will publish to GitHub Pages.');
