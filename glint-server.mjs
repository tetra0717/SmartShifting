// Relay only: optical decoding stays in each display Worker.
export function createGlintHandler({ logger = () => {}, now = Date.now, leaseMs = 4000, deviceMs = 6000, heartbeatMs = 1500 } = {}) {
  let owner = null, ownerAt = 0, revision = 0;
  let config = { count: 6, strength: 0.8, width: 1280, height: 720, revision };
  const clients = new Map(), devices = new Map(), stoppedEpochs = new Map(), warnings = new Map();
  const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
  const online = () => !!owner && now() - ownerAt < leaseMs;
  const reply = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  function write(res, value) {
    if (res.destroyed || res.writableLength > 512000) { res.destroy(); clients.delete(res); return; }
    res.write(value);
  }
  function emit(event, data, role) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [res, client] of clients) if (!role || client.role === role) write(res, message);
  }
  function removeDevice(id, reason) {
    if (!devices.delete(id)) return;
    logger('info', 'phone.disconnected', { id, reason });
    emit('device', { id, valid: false, held: false, object: null, state: 'lost', reason, at: now() }, 'display');
  }
  function releaseDisplay(reason) {
    if (!owner) return;
    logger('info', 'display.disconnected', { owner, reason });
    owner = null;
    for (const id of devices.keys()) removeDevice(id, reason);
    stoppedEpochs.clear();
    emit('status', { online: false });
  }
  function sweep() {
    for (const res of clients.keys()) write(res, ': heartbeat\n\n');
    if (owner && !online()) releaseDisplay('PC表示の更新が途切れました');
    for (const [id, device] of devices) if (now() - device.at > deviceMs) removeDevice(id, '端末の更新が途切れました');
    for (const [key, at] of warnings) if (now() - at > 60000) warnings.delete(key);
  }
  const timer = setInterval(sweep, heartbeatMs);
  timer.unref();
  const handle = async (req, res, url) => {
    if (!url.pathname.startsWith('/api/glint/')) return false;
    const path = url.pathname.slice('/api/glint/'.length);
    try {
      if (req.method === 'GET' && path === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const role = url.searchParams.get('role') === 'display' ? 'display' : 'phone';
        clients.set(res, { role });
        write(res, `event: config\ndata: ${JSON.stringify(config)}\n\nevent: status\ndata: ${JSON.stringify({ online: online() })}\n\n`);
        if (role === 'display') for (const device of devices.values()) if (device.result) write(res, `event: device\ndata: ${JSON.stringify(device.result)}\n\n`);
        logger('info', 'stream.connected', { role, streams: clients.size });
        req.on('close', () => { clients.delete(res); logger('info', 'stream.disconnected', { role, streams: clients.size }); });
        return true;
      }
      if (req.method !== 'POST' || !['display', 'config', 'samples', 'result', 'stop', 'release', 'diagnostic'].includes(path)) {
        reply(res, 404, { error: 'Not found' }); return true;
      }
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
        reply(res, 403, { error: 'Same origin required' }); return true;
      }
      const chunks = []; let bytes = 0;
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 96000) throw new Error('Request too large');
        chunks.push(part);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JSON object');
      if (path === 'display') {
        if (!identifier(data.owner) || ![data.width, data.height].every(v => Number.isInteger(v) && v > 0 && v <= 16384)) throw new Error('Invalid display');
        if (online() && owner !== data.owner) { reply(res, 409, { error: 'GlintのPC表示は1タブだけ開いてください' }); return true; }
        const connected = owner !== data.owner || !online();
        const changed = connected || config.width !== data.width || config.height !== data.height;
        owner = data.owner; ownerAt = now();
        if (connected) logger('info', 'display.connected', { owner });
        if (changed) {
          config = { ...config, width: data.width, height: data.height, revision: ++revision };
          devices.clear(); stoppedEpochs.clear(); emit('config', config);
        }
        emit('status', { online: true }); reply(res, 200, config); return true;
      }
      if (path === 'release') {
        if (data.owner === owner) releaseDisplay('PC表示を閉じました');
        reply(res, 200, { ok: true }); return true;
      }
      if (path === 'config') {
        if (!online() || data.owner !== owner) { reply(res, 409, { error: 'PC表示の接続がありません' }); return true; }
        if (!Number.isInteger(data.count) || data.count < 1 || data.count > 20 || !Number.isFinite(data.strength) || data.strength < 0 || data.strength > 1.5) throw new Error('Invalid settings');
        config = { ...config, count: data.count, strength: data.strength, revision: ++revision };
        devices.clear(); stoppedEpochs.clear(); emit('config', config); logger('info', 'config.changed', { config });
        reply(res, 200, config); return true;
      }
      if (path === 'samples') {
        if (!online()) { reply(res, 409, { error: 'PCのGlint表示を開いてください' }); return true; }
        if (!identifier(data.id) || data.revision !== config.revision || !Number.isInteger(data.seq) || data.seq < 0 || !Array.isArray(data.samples) || data.samples.length < 1 || data.samples.length > 40) throw new Error('Invalid samples');
        let last = -Infinity;
        const samples = data.samples.map(sample => {
          if (!sample || !Number.isFinite(sample.t) || sample.t <= last || !Array.isArray(sample.rgb) || sample.rgb.length !== 3 || !sample.rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 255) || !Number.isFinite(sample.clipped) || sample.clipped < 0 || sample.clipped > 1) throw new Error('Invalid camera statistics');
          last = sample.t;
          return { t: sample.t, rgb: sample.rgb, clipped: sample.clipped };
        });
        const epoch = data.epoch ?? 0;
        if (!Number.isInteger(epoch) || epoch < 0 || epoch > 1e9) throw new Error('Invalid camera session');
        if (stoppedEpochs.has(data.id) && epoch <= stoppedEpochs.get(data.id)) { reply(res, 200, { ignored: true }); return true; }
        let device = devices.get(data.id);
        if (device && (epoch < device.epoch || data.seq <= device.seq)) { reply(res, 200, { ignored: true }); return true; }
        if (!device || epoch !== device.epoch) { logger('info', 'phone.connected', { id: data.id, epoch }); device = { resultSeq: -1, stateKey: null }; }
        Object.assign(device, { at: now(), seq: data.seq, epoch, sourceTime: last }); devices.set(data.id, device);
        emit('samples', { id: data.id, epoch, seq: data.seq, revision: config.revision, samples }, 'display');
        reply(res, 200, { ok: true }); return true;
      }
      if (path === 'result') {
        if (!online() || data.owner !== owner || data.revision !== config.revision) { reply(res, 409, { error: 'Display changed' }); return true; }
        if (!identifier(data.id) || !Number.isInteger(data.seq) || data.seq < 0 || !Number.isFinite(data.sourceTime) || typeof data.valid !== 'boolean' || (data.valid && (!Number.isInteger(data.object) || data.object < 0 || data.object >= config.count))) throw new Error('Invalid result');
        const device = devices.get(data.id);
        if (!device || (data.epoch ?? 0) !== device.epoch || data.seq <= device.resultSeq || now() - device.at > 450 || device.sourceTime - data.sourceTime > 450) { reply(res, 200, { ignored: true }); return true; }
        if (data.seq > device.seq || data.sourceTime > device.sourceTime) throw new Error('Invalid result sequence');
        const objectOK = Number.isInteger(data.object) && data.object >= 0 && data.object < config.count;
        const held = !data.valid && data.held === true && objectOK;
        const result = {
          id: data.id, epoch: data.epoch ?? 0, seq: data.seq, revision: config.revision, sourceTime: data.sourceTime,
          valid: data.valid, held, object: data.valid || held ? data.object : null,
          state: ['acquired', 'tracking', 'rechecking', 'searching', 'lost'].includes(data.state) ? data.state : 'searching',
          method: ['early', 'full', 'continuing'].includes(data.method) ? data.method : null,
          reason: String(data.reason || '').slice(0, 160), at: now(),
        };
        for (const key of ['score', 'validation', 'margin', 'rms', 'lag', 'exposure', 'duration', 'processingMs', 'signalAgeMs']) result[key] = Number.isFinite(data[key]) ? data[key] : null;
        if (Array.isArray(data.ranking)) result.ranking = data.ranking.filter(v => v && Number.isInteger(v.object) && v.object >= 0 && v.object < config.count && Number.isFinite(v.score) && Number.isFinite(v.validation)).slice(0, config.count).map(v => ({ object: v.object, score: v.score, validation: v.validation }));
        const stateKey = `${result.valid ? 'confirmed' : held ? 'held' : 'lost'}:${result.object}`;
        if (device.stateKey !== stateKey) { logger('info', 'target.changed', { id: data.id, object: result.object, valid: result.valid, held, reason: result.reason }); device.stateKey = stateKey; }
        device.resultSeq = data.seq; device.result = result;
        emit('result', result, 'phone'); emit('device', result, 'display'); reply(res, 200, { ok: true }); return true;
      }
      if (path === 'stop') {
        if (!identifier(data.id)) throw new Error('Invalid ID');
        const device = devices.get(data.id);
        const epoch = data.epoch ?? device?.epoch ?? 0;
        if (!Number.isInteger(epoch) || epoch < 0 || epoch > 1e9) throw new Error('Invalid camera session');
        stoppedEpochs.set(data.id, Math.max(stoppedEpochs.get(data.id) ?? -1, epoch));
        if (device && epoch >= device.epoch) removeDevice(data.id, 'カメラ停止中');
        reply(res, 200, { ok: true }); return true;
      }
      if (path === 'diagnostic') {
        if (!identifier(data.id) || !['display', 'phone'].includes(data.role) || !['info', 'warn', 'error'].includes(data.level) || typeof data.event !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(data.event)) throw new Error('Invalid diagnostic');
        const key = `diagnostic:${data.id}`;
        if (!warnings.has(key) || now() - warnings.get(key) >= 1000) { warnings.set(key, now()); logger(data.level, `client.${data.event}`, { id: data.id, role: data.role, message: String(data.message || '').slice(0, 500) }); }
        reply(res, 200, { ok: true }); return true;
      }
    } catch (error) {
      const key = `request:${path}`;
      if (!warnings.has(key) || now() - warnings.get(key) > 5000) { warnings.set(key, now()); logger('warn', 'request.rejected', { path, message: error.message }); }
      reply(res, 400, { error: error.message }); return true;
    }
  };
  handle.status = () => ({ displayOnline: online(), devices: devices.size, streams: clients.size, revision: config.revision });
  handle.sweep = sweep;
  handle.close = () => { clearInterval(timer); releaseDisplay('サーバー停止'); for (const res of clients.keys()) res.end(); clients.clear(); };
  return handle;
}
