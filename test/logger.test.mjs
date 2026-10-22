import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../logger.mjs';

test('structured logs filter levels and rotate within their disk budget', t => {
  const directory = mkdtempSync(join(tmpdir(), 'glint-logger-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const lines = [], output = { log: line => lines.push(line), warn: line => lines.push(line), error: line => lines.push(line) };
  const log = createLogger({ directory, maxBytes: 180, backups: 2, output });
  log('debug', 'hidden');
  for (let i = 0; i < 10; i++) log('info', 'target.changed', { id: 'phone-a', object: i });
  assert.equal(lines.length, 10);
  assert.deepEqual(readdirSync(directory).sort(), ['glint.jsonl', 'glint.jsonl.1', 'glint.jsonl.2']);
  for (const file of readdirSync(directory)) {
    const records = readFileSync(join(directory, file), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(records.every(record => record.event === 'target.changed' && record.time && record.level === 'info'));
  }
});
