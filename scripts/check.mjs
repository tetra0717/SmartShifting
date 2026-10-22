import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let checked = 0;
function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'logs'].includes(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(mjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
      checked++;
    }
  }
}
check(root);
console.log(`Syntax OK: ${checked} JavaScript files.`);
