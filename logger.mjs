import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// State changes and errors only. Camera frames and per-frame results stay in
// the explicitly downloaded browser diagnostics, away from the server log.
export function createLogger({ directory, level = 'info', maxBytes = 5 * 1024 * 1024, backups = 3, output = console } = {}) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (!(level in levels)) throw new Error(`Invalid LOG_LEVEL: ${level}`);
  if (directory) mkdirSync(directory, { recursive: true });
  const file = directory && join(directory, 'glint.jsonl');
  let bytes = file && existsSync(file) ? statSync(file).size : 0;
  let diskFailed = false;
  return (severity, event, data = {}) => {
    if (levels[severity] < levels[level]) return;
    const record = { ...data, time: new Date().toISOString(), level: severity, event };
    const line = JSON.stringify(record) + '\n';
    const method = severity === 'error' ? 'error' : severity === 'warn' ? 'warn' : 'log';
    output[method](`${record.time} ${severity.toUpperCase()} ${event} ${JSON.stringify(data)}`);
    if (!file || diskFailed) return;
    try {
      const size = Buffer.byteLength(line);
      if (bytes + size > maxBytes) {
        if (backups > 0) {
          rmSync(`${file}.${backups}`, { force: true });
          for (let i = backups - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
          if (existsSync(file)) renameSync(file, `${file}.1`);
        } else rmSync(file, { force: true });
        bytes = 0;
      }
      appendFileSync(file, line, 'utf8');
      bytes += size;
    } catch (error) {
      diskFailed = true;
      output.error(`Log file unavailable; continuing with console logs: ${error.message}`);
    }
  };
}
