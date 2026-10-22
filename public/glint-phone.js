import { cropStats, NAMES } from './glint-common.js';
import { createDiagnostics } from './glint-diagnostics.js';
const $ = id => document.getElementById(id),
  video = $('video'),
  preview = $('preview'),
  ctx = preview.getContext('2d', {
    willReadFrequently: true,
    alpha: false
  });
const id = crypto.randomUUID?.() || `phone-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let config = {
    revision: -1
  },
  connected = false,
  displayOnline = false,
  stream = null,
  generation = 0,
  epoch = 0,
  samples = [],
  seq = 0,
  lastSeq = -1,
  lastSend = 0,
  sending = false,
  lastMedia = -1,
  lastFrame = 0,
  fps = 0,
  lastValid = 0,
  lastObject = null,
  lastResult = 0;
const diagnostics = createDiagnostics('phone', id);
let frameLog = [];
$('identity').textContent = `端末 ${id.slice(0, 8)} · カメラの平均RGBのみPCへ送信`;
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
function log(type, data) {
  diagnostics.log(type, data);
}
function fail(type, error) {
  $('error').textContent = error.message || String(error);
  diagnostics.error(type, error);
}
function reset(message = '新しい揺らぎを収集中') {
  epoch++;
  samples = [];
  lastValid = 0;
  lastObject = null;
  lastSeq = -1;
  lastResult = 0;
  $('object').textContent = '—';
  $('state').textContent = message;
  $('state').dataset.valid = 'false';
  $('metrics').textContent = '—';
  $('ranking').textContent = '';
}
function invalidate(message) {
  $('state').textContent = message;
  $('state').dataset.valid = 'false';
  $('object').textContent = '—';
  lastObject = null;
  lastValid = 0;
}
function stop() {
  const stoppedEpoch = epoch,
    wasRunning = !!stream;
  generation++;
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  lastMedia = -1;
  lastFrame = 0;
  reset('カメラ停止中');
  $('start').disabled = false;
  $('stop').disabled = true;
  post('stop', {
    id,
    epoch: stoppedEpoch
  }).catch(() => {});
  if (wasRunning) log('camera.stopped');
}
async function cameras() {
  const selected = $('camera').value;
  const options = [new Option('背面カメラ（自動）', '')];
  for (const d of await navigator.mediaDevices.enumerateDevices()) if (d.kind === 'videoinput') options.push(new Option(d.label || `カメラ ${options.length}`, d.deviceId));
  $('camera').replaceChildren(...options);
  $('camera').value = selected;
}
async function start() {
  stop();
  const token = ++generation;
  $('error').textContent = '';
  $('start').disabled = true;
  try {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('カメラにはHTTPSが必要です。PCに表示されるHTTPS URLを開いてください。');
    const selected = $('camera').value,
      opened = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(selected ? {
            deviceId: {
              exact: selected
            }
          } : {
            facingMode: {
              ideal: 'environment'
            }
          }),
          width: {
            ideal: 640
          },
          height: {
            ideal: 480
          },
          frameRate: {
            ideal: 30
          }
        }
      });
    if (token !== generation) {
      opened.getTracks().forEach(t => t.stop());
      return;
    }
    stream = opened;
    video.srcObject = opened;
    await video.play();
    if (token !== generation) return;
    $('stop').disabled = false;
    reset('オブジェクトへ近づけて静止させてください');
    log('camera', {
      settings: opened.getVideoTracks()[0].getSettings()
    });
    cameras().catch(() => {});
    opened.getVideoTracks()[0].addEventListener('ended', () => {
      if (token === generation) {
        stop();
        fail('camera.ended', new Error('カメラが停止しました。再起動してください。'));
      }
    });
    schedule(token);
  } catch (e) {
    if (token === generation) {
      stop();
      fail('camera.error', new Error({
        NotAllowedError: 'カメラの許可・HTTPS証明書を確認してください。',
        NotReadableError: 'カメラを使用中の別アプリを閉じてください。',
        OverconstrainedError: '選んだカメラを起動できません。背面カメラ（自動）で試してください。'
      }[e.name] || e.message));
    }
  }
}
function schedule(token) {
  if (!stream || token !== generation) return;
  const callback = (now, meta) => {
    if (!stream || token !== generation) return;
    try {
      const time = meta?.mediaTime ?? video.currentTime;
      if (time !== lastMedia && video.readyState >= 2) {
        lastMedia = time;
        analyze(performance.now());
      }
    } catch (e) {
      fail('camera.analysis', e);
      stop();
      return;
    }
    schedule(token);
  };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(callback);else requestAnimationFrame(callback);
}
function analyze(t) {
  if (lastFrame) {
    const dt = t - lastFrame;
    if (dt > 180) reset('撮影間隔が空いたため再取得中');
    fps = fps ? fps * .85 + 1000 / dt * .15 : 1000 / dt;
  }
  lastFrame = t;
  const size = Math.min(video.videoWidth, video.videoHeight) * .7;
  ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, 64, 64);
  const value = cropStats(ctx.getImageData(0, 0, 64, 64).data);
  samples.push({
    t,
    ...value
  });
  while (samples.length > 40 || samples.length > 1 && t - samples[0].t > 850) samples.shift();
  if ($('record').checked) {
    frameLog.push({
      t,
      ...value
    });
    if (frameLog.length > 1800) frameLog.shift();
  }
  $('fps').textContent = `撮影 ${fps.toFixed(1)} fps · RGB ${value.rgb.map(v => v.toFixed(1)).join(' / ')} · 飽和 ${(100 * value.clipped).toFixed(1)}%`;
  if (stream && connected && displayOnline && !sending && samples.length >= 10 && t - lastSend > 65) {
    lastSend = t;
    sending = true;
    const submitted = seq++,
      revision = config.revision,
      submittedEpoch = epoch;
    post('samples', {
      id,
      epoch: submittedEpoch,
      seq: submitted,
      revision,
      samples: [...samples]
    }).then(() => {
      if (epoch === submittedEpoch && revision === config.revision) $('network').textContent = 'PCへカメラ統計を送信中';
    }).catch(e => {
      if (epoch === submittedEpoch && revision === config.revision) {
        invalidate(e.message);
        $('network').textContent = e.message;
        diagnostics.error('samples.error', e);
      }
    }).finally(() => {
      sending = false;
    });
  }
}
const events = new EventSource('/api/glint/events?role=phone');
events.addEventListener('config', e => {
  const next = JSON.parse(e.data);
  if (next.revision !== config.revision) reset(stream ? '表示設定を更新しました。再取得中' : 'カメラ停止中');
  config = next;
  connected = true;
  log('config', {
    config
  });
});
events.addEventListener('status', e => {
  const status = JSON.parse(e.data),
    changed = displayOnline !== status.online;
  displayOnline = status.online;
  connected = true;
  if (changed) {
    samples = [];
    log('display.status', {
      online: displayOnline
    });
    if (!displayOnline) invalidate('PCのGlint表示が停止しています');
  }
  $('network').textContent = displayOnline ? 'PC表示に接続済み' : 'PCで表示ページを開いてください';
});
events.addEventListener('result', e => {
  const r = JSON.parse(e.data);
  if (r.id !== id || r.epoch !== epoch || r.revision !== config.revision || r.seq <= lastSeq || !stream || !samples.length || samples.at(-1).t - r.sourceTime > 450 || r.sourceTime < samples[0].t) return;
  lastSeq = r.seq;
  lastResult = performance.now();
  log('result', {
    result: r
  });
  $('metrics').textContent = `初回適合 ${r.score?.toFixed(3) ?? '—'} · 直近確認 ${r.validation?.toFixed(3) ?? '—'} · 候補差 ${r.margin?.toFixed(3) ?? '—'}\n観測窓 ${r.duration?.toFixed(0) ?? '—'} ms + 復号 ${r.processingMs?.toFixed(1) ?? '—'} ms（通信時間は別）`;
  $('ranking').textContent = (r.ranking || []).map(v => `${v.object + 1} ${NAMES[v.object]}  ${v.score.toFixed(3)} / ${v.validation.toFixed(3)}`).join('\n');
  if (r.valid) {
    lastValid = performance.now();
    lastObject = r.object;
    $('object').textContent = NAMES[r.object];
    $('state').textContent = r.state === 'tracking' ? '対象の揺らぎを継続確認中' : r.method === 'early' ? '短い観測で対象を確認しました' : '対象を確認しました';
    $('state').dataset.valid = 'true';
  } else if (r.held && r.object === lastObject && performance.now() - lastValid < 350) {
    $('object').textContent = NAMES[lastObject];
    $('state').textContent = '対象を保持して信号を再確認中';
    $('state').dataset.valid = 'held';
  } else invalidate(r.reason);
});
events.onerror = () => {
  connected = false;
  displayOnline = false;
  invalidate('接続を再試行中');
  $('network').textContent = 'サーバーの接続を確認してください';
  diagnostics.error('connection.error', new Error('サーバー接続が途切れました'));
};
setInterval(() => {
  if (stream && lastResult && performance.now() - lastResult > 450) invalidate('新しい判定が届いていません');
  if (lastObject !== null && performance.now() - lastValid > 450) invalidate('揺らぎを再取得中');
}, 100);
$('start').onclick = start;
$('stop').onclick = stop;
$('reset').onclick = () => {
  post('stop', {
    id,
    epoch
  }).catch(() => {});
  reset();
  log('camera.reset');
};
$('camera').onchange = () => {
  if (stream) start();
};
$('export').onclick = () => diagnostics.download({
  config,
  frames: frameLog
});
$('record').onchange = () => {
  frameLog = [];
  log('recording', {
    enabled: $('record').checked
  });
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && stream) stop();
});
addEventListener('pagehide', () => {
  navigator.sendBeacon?.('/api/glint/stop', new Blob([JSON.stringify({
    id,
    epoch
  })], {
    type: 'application/json'
  }));
  stop();
  events.close();
});
