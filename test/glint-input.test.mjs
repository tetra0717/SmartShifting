import test from 'node:test';
import assert from 'node:assert/strict';
import { GlintInput } from '../public/glint-input.js';

test('game input emits once per acquisition, keeps phones independent, and releases on loss', () => {
  let now = 1000;
  const input = new GlintInput({ now: () => now }), events = [];
  for (const type of ['acquired', 'released']) input.addEventListener(type, e => events.push([type, e.detail.deviceId, e.detail.objectId]));
  const update = (id, object, patch = {}) => input.update({ id, object, valid: true, epoch: 1, at: now, ...patch });
  update('a', 0); update('a', 0); update('b', 19);
  assert.deepEqual(events, [['acquired', 'a', 0], ['acquired', 'b', 19]]);
  update('a', 2);
  assert.deepEqual(events.slice(-2), [['released', 'a', 0], ['acquired', 'a', 2]]);
  update('a', null, { valid: false, held: false });
  assert.equal(input.targets.has('a'), false);
  assert.equal(input.targets.get('b').object, 19);
  input.clear(); assert.equal(input.targets.size, 0);
});

test('held or stale results cannot create game actions or extend freshness indefinitely', () => {
  let now = 1000;
  const input = new GlintInput({ now: () => now }), events = [];
  for (const type of ['acquired', 'released']) input.addEventListener(type, () => events.push(type));
  input.update({ id: 'a', object: 0, valid: false, held: true, at: now });
  assert.equal(events.length, 0);
  input.update({ id: 'a', object: 0, valid: true, at: now });
  now += 200;
  input.update({ id: 'a', object: 0, valid: false, held: true, at: now });
  assert.equal(input.targets.size, 1);
  now += 251; input.expire();
  assert.deepEqual(events, ['acquired', 'released']);
  input.update({ id: 'a', object: 0, valid: true, at: 1000 });
  assert.equal(input.targets.size, 0);
});

test('a new camera session releases the old target before reacquiring', () => {
  const input = new GlintInput({ now: () => 1000 }), events = [];
  for (const type of ['acquired', 'released']) input.addEventListener(type, () => events.push(type));
  input.update({ id: 'a', object: 0, valid: true, at: 1000, epoch: 1 });
  input.update({ id: 'a', object: 0, valid: true, at: 1000, epoch: 2 });
  assert.deepEqual(events, ['acquired', 'released', 'acquired']);
});
