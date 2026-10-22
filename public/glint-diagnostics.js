export function createDiagnostics(role, id) {
  const logs = [], reported = new Map();
  function log(type, data = {}) {
    logs.push({ type, at: Date.now(), ...data });
    if (logs.length > 200) logs.shift();
  }
  function error(type, error) {
    const message = error?.message || String(error), key = `${type}:${message}`;
    if (reported.has(key) && Date.now() - reported.get(key) < 5000) return;
    reported.set(key, Date.now());
    if (reported.size > 100) reported.delete(reported.keys().next().value);
    log(type, { message });
    console.error(`[Glint/${role}] ${type}: ${message}`);
    fetch('/api/glint/diagnostic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role, level: 'error', event: type, message }), keepalive: true,
    }).catch(() => {});
  }
  addEventListener('error', event => error('runtime.error', event.error || event.message));
  addEventListener('unhandledrejection', event => error('promise.error', event.reason));
  return {
    logs, log, error,
    download(data) {
      const contents = { formatVersion: 1, kind: `glint-${role}`, createdAt: new Date().toISOString(), id, logs, ...data };
      const url = URL.createObjectURL(new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `smartshifting-glint-${role}-${Date.now()}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
