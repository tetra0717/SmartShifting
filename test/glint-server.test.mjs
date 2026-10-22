import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';

async function fixture(t) {
  let time = 1000;
  const logs = [], controllers = [];
  const app = createApp({ now: () => time, heartbeatMs: 20, info: { addresses: [], https: false }, logger: (...args) => logs.push(args) });
  const server = http.createServer(app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    app.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const get = path => fetch(root + path, { signal: AbortSignal.timeout(3000) });
  const post = async (path, data, headers = {}) => {
    const response = await fetch(root + '/api/glint/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data), signal: AbortSignal.timeout(3000) });
    return { status: response.status, data: await response.json() };
  };
  async function stream(role) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(root + '/api/glint/events?role=' + role, { signal: controller.signal });
    const reader = response.body.getReader(), decoder = new TextDecoder(), queue = [], waiting = [];
    let buffer = '';
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split;
          while ((split = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, split); buffer = buffer.slice(split + 2);
            const name = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
            if (!name || !data) continue;
            const event = { name, data: JSON.parse(data) }, index = waiting.findIndex(w => w.name === name && w.predicate(event.data));
            if (index < 0) queue.push(event);
            else { const [waiter] = waiting.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(event.data); }
          }
        }
      } catch (error) { if (!controller.signal.aborted) throw error; }
    })().catch(error => { for (const waiter of waiting) waiter.reject(error); });
    return { next(name, predicate = () => true) {
      const index = queue.findIndex(event => event.name === name && predicate(event.data));
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0].data);
      return new Promise((resolve, reject) => {
        const waiter = { name, predicate, resolve, reject };
        waiter.timer = setTimeout(() => { waiting.splice(waiting.indexOf(waiter), 1); reject(new Error(`SSE timeout: ${name}`)); }, 2500);
        waiting.push(waiter);
      });
    } };
  }
  const claim = () => post('display', { owner: 'display-a', width: 1280, height: 720 });
  const samples = (revision, id = 'phone-a', seq = 0, epoch = 1) => ({ id, seq, epoch, revision, samples: [{ t: 1000 + seq * 30, rgb: [100, 110, 120], clipped: 0 }] });
  const result = (packet, patch = {}) => ({ owner: 'display-a', id: packet.id, epoch: packet.epoch, seq: packet.seq, revision: packet.revision, sourceTime: packet.samples.at(-1).t, object: 0, valid: true, state: 'acquired', ...patch });
  return { get, post, stream, claim, samples, result, logs, advance: duration => { time += duration; } };
}

test('Glint is the only served mode; assets and aliases work, retired modes return 404', async t => {
  const f = await fixture(t);
  for (const path of ['/', '/glint', '/phone', '/glint-phone', '/setup', '/setup.js', '/glint-display.js', '/glint-phone.js', '/glint-worker.js', '/glint-receiver.js', '/glint-common.js', '/glint.css', '/glint-diagnostics.js', '/glint-input.js', '/game.js']) assert.equal((await f.get(path)).status, 200, path);
  assert.match(await (await f.get('/')).text(), /SMARTSHIFTING \/ GLINT/);
  assert.match(await (await f.get('/phone')).text(), /対象を読み取る/);
  for (const path of ['/legacy', '/legacy-phone', '/probe.html', '/optical.js', '/api/probe/config', '/api/events', '/test.mp4', '/.certs/localhost-key.pem']) assert.equal((await f.get(path)).status, 404, path);
  assert.equal((await (await f.get('/api/health')).json()).mode, 'glint');
});

test('display ownership, defaults, origin checks and malformed requests are enforced', async t => {
  const f = await fixture(t), { data: config } = await f.claim();
  assert.equal(config.count, 6); assert.equal(config.strength, .8);
  assert.equal((await f.post('display', { owner: 'display-b', width: 1000, height: 800 })).status, 409);
  assert.equal((await f.post('config', { owner: 'display-a', count: 20, strength: .8 }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.post('config', { owner: 'display-a', count: 21, strength: .8 })).status, 400);
  assert.equal((await f.post('samples', null)).status, 400);
  assert.equal((await f.post('samples', { huge: 'x'.repeat(97000) })).status, 400);
  const packet = f.samples(config.revision); packet.samples[0].rgb[1] = -1;
  assert.equal((await f.post('samples', packet)).status, 400);
  assert.equal((await f.post('missing', {})).status, 404);
});

test('two phones relay independent results; old sessions, sequences and late stops are ignored', async t => {
  const f = await fixture(t), display = await f.stream('display'), phone = await f.stream('phone');
  await display.next('config'); await phone.next('config');
  const { data: config } = await f.claim();
  await phone.next('status', value => value.online);
  const updated = await f.post('config', { owner: 'display-a', count: 20, strength: .8 });
  Object.assign(config, updated.data);
  for (const [id, object] of [['phone-a', 0], ['phone-b', 19]]) {
    const packet = f.samples(config.revision, id);
    assert.equal((await f.post('samples', packet)).status, 200);
    assert.equal((await display.next('samples', value => value.id === id)).id, id);
    assert.equal((await f.post('result', f.result(packet, { object }))).status, 200);
    assert.equal((await phone.next('result', value => value.id === id)).object, object);
  }
  const packet = f.samples(config.revision, 'phone-b', 1, 2);
  await f.post('samples', packet); await f.post('result', f.result(packet, { object: 19 }));
  assert.equal((await f.post('result', f.result(packet))).data.ignored, true);
  assert.equal((await f.post('samples', { ...packet, seq: 2, epoch: 1 })).data.ignored, true);
  await f.post('stop', { id: packet.id, epoch: 1 });
  assert.equal((await (await f.get('/api/health')).json()).devices, 2);
  const next = f.samples(config.revision, packet.id, 2, 2); await f.post('samples', next);
  await f.post('result', f.result(next, { object: 19 }));
  assert.equal(f.logs.filter(([, event, data]) => event === 'target.changed' && data.object === 19).length, 2);
  await f.post('stop', { id: packet.id, epoch: 2 });
  assert.equal((await display.next('device', value => value.state === 'lost')).valid, false);
  assert.equal((await (await f.get('/api/health')).json()).devices, 1);
  await f.post('stop', { id: 'phone-a', epoch: 1 });
  assert.equal((await (await f.get('/api/health')).json()).devices, 0);
});

test('lease expiry clears devices, reports loss, and permits a fresh display session', async t => {
  const f = await fixture(t), phone = await f.stream('phone');
  await phone.next('status', value => !value.online);
  const { data: config } = await f.claim(); await phone.next('status', value => value.online);
  await f.post('samples', f.samples(config.revision));
  f.advance(4001);
  await phone.next('status', value => !value.online);
  const health = await (await f.get('/api/health')).json();
  assert.equal(health.devices, 0); assert.equal(health.displayOnline, false);
  assert.equal((await f.claim()).data.revision, config.revision + 1);
  assert.ok(f.logs.some(([, event]) => event === 'display.disconnected'));
});

test('a late sample cannot revive a stopped camera and a slow result cannot become a fresh game action', async t => {
  const f = await fixture(t), { data: config } = await f.claim();
  const packet = f.samples(config.revision);
  await f.post('samples', packet);
  f.advance(451);
  assert.equal((await f.post('result', f.result(packet))).data.ignored, true);
  await f.post('stop', { id: packet.id, epoch: packet.epoch });
  assert.equal((await f.post('samples', { ...packet, seq: 1 })).data.ignored, true);
  assert.equal((await (await f.get('/api/health')).json()).devices, 0);
  const restarted = { ...packet, seq: 2, epoch: 2 };
  assert.equal((await f.post('samples', restarted)).data.ok, true);
  assert.equal((await (await f.get('/api/health')).json()).devices, 1);
});
