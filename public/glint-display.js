import { layout, envelope, NAMES } from './glint-common.js';
import { createDiagnostics } from './glint-diagnostics.js';
import { GlintInput } from './glint-input.js';
import { connectGame } from './game.js';
const $ = id => document.getElementById(id),
  canvas = $('scene'),
  ctx = canvas.getContext('2d', {
    willReadFrequently: true,
    alpha: false
  });
const ref = document.createElement('canvas'),
  rc = ref.getContext('2d', {
    willReadFrequently: true,
    alpha: false
  });
ref.width = 192;
ref.height = 108;
const owner = crypto.randomUUID?.() || `display-${Date.now()}`;
const diagnostics = createDiagnostics('display', owner),
  input = new GlintInput();
const slots = Array.from({
  length: Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))
}, () => ({
  worker: new Worker('/glint-worker.js', {
    type: 'module'
  }),
  current: null
}));
let config = {
    count: 6,
    strength: .8,
    width: innerWidth,
    height: innerHeight,
    revision: -1
  },
  objects = [],
  online = false,
  history = [],
  lastRef = 0,
  lastFrame = 0,
  frames = 0,
  fps = 0,
  lastStats = 0;
const pending = new Map(),
  assignments = new Map(),
  devices = new Map(),
  activity = new Map(),
  cameraEpochs = new Map(),
  measurements = [];
connectGame(input, {
  animate: object => activity.set(object, performance.now() + 2000)
});
for (const type of ['acquired', 'released']) input.addEventListener(type, ({
  detail
}) => diagnostics.log(`target.${type}`, detail));
const post = async (path, data) => {
  const r = await fetch('/api/glint/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || r.status);
  return v;
};
function fail(type, error) {
  $('error').textContent = error.message || String(error);
  diagnostics.error(type, error);
}
function clear(reason) {
  history = [];
  pending.clear();
  devices.clear();
  assignments.clear();
  cameraEpochs.clear();
  input.clear(reason);
  paintDevices();
}
function apply(next) {
  if (next.revision !== config.revision) {
    clear('表示設定を更新しました');
    diagnostics.log('config', {
      config: next
    });
  }
  config = next;
  canvas.width = config.width;
  canvas.height = config.height;
  objects = layout(config.count, canvas.width, canvas.height);
  $('count').value = config.count;
  $('strength').value = config.strength;
  $('strengthValue').textContent = config.strength.toFixed(2);
}
let claiming = false;
async function claim() {
  if (claiming) return;
  claiming = true;
  try {
    const next = await post('display', {
      owner,
      width: innerWidth,
      height: innerHeight
    });
    online = events.readyState === 1;
    if (next.revision !== config.revision) apply(next);
    $('connection').textContent = online ? 'PC表示に接続済み' : '通信の接続を待っています';
  } catch (e) {
    online = false;
    clear(e.message);
    $('connection').textContent = e.message;
    diagnostics.error('connection.error', e);
  } finally {
    claiming = false;
  }
}
function icon(o, t) {
  const cx = o.x + o.w * .5,
    cy = o.y + o.h * .5,
    s = Math.min(o.w, o.h) * .17,
    move = (activity.get(o.id) || 0) > t;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(t / 900 + o.id) * .08 + (move ? Math.sin(t / 110) * .17 : 0));
  ctx.fillStyle = ['#8fadc2', '#a385bd', '#88b2a0', '#b9a373', '#bb829b', '#adc0bc', '#ad95c4', '#a5acbe', '#be927d'][o.id % 9];
  const p = s / 4;
  if (o.id % 3 === 0) {
    ctx.fillRect(-p, -s * 1.5, p * 2, s * 2);
    ctx.fillRect(-s * .8, s * .4, s * 1.6, p * 2);
    ctx.fillStyle = '#594876';
    ctx.fillRect(-p, s * .7, p * 2, s * .6);
  } else if (o.id % 3 === 1) {
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.3);
    ctx.lineTo(s, 0);
    ctx.lineTo(s * .45, s);
    ctx.lineTo(-s * .45, s);
    ctx.lineTo(-s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d1bce1';
    ctx.fillRect(-p, -s * .65, p * .8, s * 1.3);
  } else {
    ctx.fillRect(-s, -s, s * 2, s * 1.3);
    ctx.fillRect(-s * .7, s * .3, s * 1.4, p * 2);
    ctx.fillRect(-s * .4, s * .8, s * .8, p * 2);
    ctx.fillStyle = '#566c76';
    ctx.fillRect(-p, -s * .6, p * 2, s);
  }
  ctx.restore();
}
function draw(now) {
  requestAnimationFrame(draw);
  if (!online || document.hidden) return;
  if (lastFrame && now - lastFrame > 140) {
    history = [];
    pending.clear();
    input.clear('描画間隔が空きました');
  }
  lastFrame = now;
  ctx.fillStyle = '#101424';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const o of objects) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(o.x, o.y, o.w, o.h);
    ctx.clip();
    ctx.fillStyle = '#44405b';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    const tile = 22;
    for (let y = 0; y < o.h; y += tile) for (let x = 0; x < o.w; x += tile) {
      const v = .12 + .05 * Math.sin(x * .05 + y * .09 + now * .0012 + o.id);
      ctx.fillStyle = `rgba(135,132,176,${v})`;
      ctx.fillRect(o.x + x, o.y + y, tile - 2, tile - 2);
    }
    icon(o, now);
    ctx.fillStyle = '#c6bfd3';
    ctx.font = `${Math.max(12, Math.min(21, o.h * .08))}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(`${o.id + 1} · ${o.name}`, o.x + o.w * .5, o.y + o.h * .88);
    if (config.strength > 0) {
      const a = envelope(o.id, now),
        b = envelope(o.id, now, 1);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(${Math.round(148 + 34 * b)},${Math.round(70 + 20 * b)},245,${Math.min(.65, config.strength * (.22 + .12 * a))})`;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      // Broad diagonal glint ribbons travel across the object. Their intensity
      // shares its ID envelope, so blur of the ribbons retains a coded component.
      ctx.globalAlpha = Math.min(.3, config.strength * (.06 + .025 * b));
      ctx.strokeStyle = '#9e68f6';
      ctx.lineWidth = o.w * .13;
      const period = o.w * .64,
        shift = now * .075 * (1 + o.id * .06) % period;
      for (let i = -3; i < 5; i++) {
        const x = o.x + i * period + shift;
        ctx.beginPath();
        ctx.moveTo(x, o.y);
        ctx.lineTo(x + o.h * .6, o.y + o.h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    ctx.strokeStyle = '#716381';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x, o.y, o.w, o.h);
  }
  if (now - lastRef >= 30) {
    lastRef = now;
    capture(now);
  }
  frames++;
  if (now - lastStats >= 1000) {
    fps = frames * 1000 / (now - lastStats);
    frames = 0;
    lastStats = now;
    $('stats').textContent = `描画 ${fps.toFixed(0)} fps · 参照 ${history.length}枚 · 接続端末 ${devices.size}`;
    paintDevices();
  }
  dispatch();
}
function capture(t) {
  ref.height = Math.max(32, Math.round(ref.width * canvas.height / canvas.width));
  rc.drawImage(canvas, 0, 0, ref.width, ref.height);
  const data = rc.getImageData(0, 0, ref.width, ref.height).data,
    profiles = objects.map(o => {
      const values = [];
      for (const [u, v, size] of [[.5, .5, .75], [.25, .25, .23], [.75, .25, .23], [.25, .75, .23], [.75, .75, .23]]) {
        const sum = [0, 0, 0],
          x0 = Math.max(0, Math.floor((o.x + o.w * (u - size / 2)) / canvas.width * ref.width)),
          x1 = Math.min(ref.width, Math.ceil((o.x + o.w * (u + size / 2)) / canvas.width * ref.width));
        const y0 = Math.max(0, Math.floor((o.y + o.h * (v - size / 2)) / canvas.height * ref.height)),
          y1 = Math.min(ref.height, Math.ceil((o.y + o.h * (v + size / 2)) / canvas.height * ref.height));
        let n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          n++;
          for (let k = 0; k < 3; k++) sum[k] += data[(y * ref.width + x) * 4 + k];
        }
        values.push(...sum.map(v => v / Math.max(1, n)));
      }
      // The uniform glint is affine in a, b and a*b before the camera's ISP.
      // Retain these designed components as an additional reference independent
      // of where a narrow decorative ribbon happens to cross the camera.
      const a = envelope(o.id, t),
        b = envelope(o.id, t, 1);
      values.push(128 + 64 * a, 128 + 64 * b, 128 + 64 * a * b);
      return values;
    });
  history.push({
    t,
    objects: profiles
  });
  while (history.length > 90 || history.length > 1 && t - history[0].t > 2000) history.shift();
}
function dispatch() {
  if (!pending.size || history.length < 12 || !online || document.hidden) return;
  for (const [id, data] of pending) {
    let index = assignments.get(id);
    if (index === undefined) {
      const loads = slots.map((_, i) => [...assignments.values()].filter(v => v === i).length);
      index = loads.indexOf(Math.min(...loads));
      assignments.set(id, index);
    }
    const slot = slots[index];
    if (slot.current) continue;
    pending.delete(id);
    slot.current = {
      ...data,
      started: performance.now()
    };
    slot.worker.postMessage({
      id,
      epoch: data.epoch,
      history,
      config,
      samples: data.samples
    });
  }
}
for (const slot of slots) {
  slot.worker.onmessage = async ({
    data
  }) => {
    const job = slot.current;
    slot.current = null;
    if (!job) return;
    const result = {
      ...data,
      id: job.id,
      epoch: job.epoch,
      seq: job.seq,
      revision: job.revision,
      sourceTime: job.samples.at(-1).t
    };
    dispatch();
    if (job.revision === config.revision && job.epoch === cameraEpochs.get(job.id) && online && !document.hidden) {
      if ($('record').checked) {
        measurements.push({
          input: job.samples,
          result,
          reference: history.filter(f => f.t >= history.at(-1).t - 1500)
        });
        if (measurements.length > 24) measurements.shift();
      }
      try {
        await post('result', {
          owner,
          ...result
        });
      } catch (e) {
        fail('result.error', e);
      }
    }
  };
  slot.worker.onerror = e => {
    slot.current = null;
    input.clear('復号処理でエラーが発生しました');
    fail('worker.error', e);
  };
}
function paintDevices() {
  const frag = document.createDocumentFragment();
  for (const [id, d] of devices) {
    const row = document.createElement('div'),
      fresh = Date.now() - d.at < 450;
    row.textContent = `${id.slice(0, 8)} · ${fresh && (d.valid || d.held) ? NAMES[d.object] : '未確定'} · ${fresh ? d.held ? '再確認中' : d.valid ? '確認済み' : d.reason || '取得中' : '受信待ち'}`;
    frag.append(row);
  }
  if (!devices.size) {
    const empty = document.createElement('p');
    empty.className = 'fine';
    empty.textContent = 'スマホの接続を待っています。';
    frag.append(empty);
  }
  $('devices').replaceChildren(frag);
}
const events = new EventSource('/api/glint/events?role=display');
events.addEventListener('config', e => apply(JSON.parse(e.data)));
events.addEventListener('open', () => {
  diagnostics.log('connection.open');
  claim();
});
events.addEventListener('samples', e => {
  const d = JSON.parse(e.data);
  if (d.revision === config.revision && online && !document.hidden) {
    if (cameraEpochs.get(d.id) !== d.epoch) input.release(d.id, 'カメラを再取得しました');
    cameraEpochs.set(d.id, d.epoch);
    pending.set(d.id, d);
  }
  dispatch();
});
events.addEventListener('device', e => {
  const d = JSON.parse(e.data);
  if (d.revision !== undefined && d.revision !== config.revision) return;
  input.update(d);
  if (d.epoch === undefined) {
    pending.delete(d.id);
    assignments.delete(d.id);
    cameraEpochs.delete(d.id);
    devices.delete(d.id);
  } else devices.set(d.id, d);
  paintDevices();
});
events.onerror = () => {
  $('connection').textContent = '接続を再試行中';
  online = false;
  clear('サーバー接続が途切れました');
  diagnostics.error('connection.error', new Error('サーバー接続が途切れました'));
};
$('strength').oninput = () => {
  $('strengthValue').textContent = Number($('strength').value).toFixed(2);
};
$('apply').onclick = async () => {
  try {
    $('error').textContent = '';
    apply(await post('config', {
      owner,
      count: Number($('count').value),
      strength: Number($('strength').value)
    }));
  } catch (e) {
    fail('config.error', e);
  }
};
$('fullscreen').onclick = () => document.documentElement.requestFullscreen().catch(e => fail('fullscreen.error', e));
function hide() {
  const hidden = !$('controls').hidden;
  $('controls').hidden = hidden;
  $('show').hidden = !hidden;
}
$('hide').onclick = $('show').onclick = hide;
addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'h' && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) hide();
});
canvas.onclick = e => {
  const o = objects.find(o => e.clientX >= o.x && e.clientX <= o.x + o.w && e.clientY >= o.y && e.clientY <= o.y + o.h);
  if (o) activity.set(o.id, performance.now() + 2000);
};
$('export').onclick = () => diagnostics.download({
  config,
  objects,
  measurements
});
$('record').onchange = () => {
  measurements.length = 0;
  diagnostics.log('recording', {
    enabled: $('record').checked
  });
};
fetch('/api/info').then(r => {
  if (!r.ok) throw new Error('接続情報を取得できません');
  return r.json();
}).then(info => {
  const urls = [];
  if (info.https) for (const ip of info.addresses) urls.push(`https://${ip}:${info.httpsPort}/phone`);
  if (info.publicUrl) urls.push(new URL('/phone', info.publicUrl).href);
  for (const url of new Set(urls)) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    $('urls').append(a);
  }
  if (!urls.length) {
    $('urls').textContent = info.https ? 'LAN接続を確認してください。' : 'HTTPSが起動していません。サーバーログを確認してください。';
  }
}).catch(e => fail('info.error', e));
addEventListener('resize', () => claim());
document.addEventListener('visibilitychange', () => {
  clear('PC表示を切り替えました');
  if (document.hidden) {
    online = false;
    navigator.sendBeacon?.('/api/glint/release', new Blob([JSON.stringify({
      owner
    })], {
      type: 'application/json'
    }));
  } else claim();
});
addEventListener('pagehide', () => {
  events.close();
  input.clear('PC表示を閉じました');
  navigator.sendBeacon?.('/api/glint/release', new Blob([JSON.stringify({
    owner
  })], {
    type: 'application/json'
  }));
});
apply(config);
claim();
setInterval(() => {
  if (!document.hidden) claim();
}, 1500);
setInterval(() => input.expire(), 100);
requestAnimationFrame(draw);
