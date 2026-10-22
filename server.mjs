import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { X509Certificate } from 'node:crypto';
import { certificate } from './certificate.mjs';
import { createGlintHandler } from './glint-server.mjs';
import { createLogger } from './logger.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const assets = ['glint-common.js', 'glint-display.js', 'glint-phone.js', 'glint-receiver.js', 'glint-worker.js', 'glint.css', 'glint-diagnostics.js', 'glint-input.js', 'game.js', 'setup.js'];
const files = new Map([
  ['/', 'glint.html'], ['/glint', 'glint.html'], ['/glint.html', 'glint.html'],
  ['/phone', 'glint-phone.html'], ['/glint-phone', 'glint-phone.html'], ['/glint-phone.html', 'glint-phone.html'],
  ['/setup', 'setup.html'],
  ...assets.map(file => ['/' + file, file]),
]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function createApp({ root = projectRoot, info = {}, certificates = {}, logger = () => {}, ...options } = {}) {
  const glint = createGlintHandler({ logger, ...options });
  const handle = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (await glint(req, res, url)) return;
      if (req.method === 'GET' && url.pathname === '/api/info') return json(res, 200, { mode: 'glint', ...info });
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, mode: 'glint', ...glint.status() });
      if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/setup/ca.crt') {
        if (!certificates.ca) return json(res, 404, { error: 'This PC uses an existing or custom HTTPS certificate.' });
        res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="glint-local-ca.crt"', 'Cache-Control': 'no-store', 'Content-Length': certificates.ca.length });
        return res.end(req.method === 'HEAD' ? undefined : certificates.ca);
      }
      if (['GET', 'HEAD'].includes(req.method) && files.has(url.pathname)) {
        const file = files.get(url.pathname), contents = readFileSync(join(root, 'public', file));
        res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store', 'Content-Length': contents.length });
        return res.end(req.method === 'HEAD' ? undefined : contents);
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      logger('error', 'http.error', { message: error.message });
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
      else res.destroy();
    }
  };
  return { handle, close: glint.close };
}

async function main() {
  const logger = createLogger({ directory: process.env.LOG_DIR || join(projectRoot, 'logs'), level: process.env.LOG_LEVEL || 'info' });
  const addresses = [...new Set(Object.values(networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address))];
  const httpPort = Number(process.env.PORT || 8080), httpsPort = Number(process.env.HTTPS_PORT || 8443);
  if (![httpPort, httpsPort].every(n => Number.isInteger(n) && n >= 0 && n <= 65535)) throw new Error('Invalid PORT or HTTPS_PORT');
  const info = { addresses, httpPort, httpsPort, https: false, caAvailable: false, caFingerprint: null, publicUrl: process.env.PUBLIC_URL || null };
  const certificates = { ca: null };
  const app = createApp({ info, certificates, logger });
  const servers = [];
  let stopping = false;
  const shutdown = (reason, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    logger(exitCode ? 'error' : 'info', 'server.stopping', { reason });
    process.exitCode = exitCode;
    app.close();
    for (const server of servers) server.close();
    const deadline = setTimeout(() => { for (const server of servers) server.closeAllConnections(); }, 2000);
    deadline.unref();
  };
  const listen = async (server, port, protocol) => {
    servers.push(server);
    await new Promise((resolveReady, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolveReady(); });
    });
    server.on('error', error => shutdown(error.message, 1));
    const actual = server.address().port;
    info[protocol === 'http' ? 'httpPort' : 'httpsPort'] = actual;
    if (protocol === 'https') info.https = true;
    logger('info', 'server.listening', { protocol, port: actual, mode: 'glint' });
  };
  try {
    if (process.env.DISABLE_HTTPS !== '1') {
      // Certificate failures still permit the PC display, with a clear warning.
      let credentials;
      try { credentials = await certificate({ root: projectRoot, addresses, logger }); }
      catch (error) { logger('warn', 'https.unavailable', { message: error.message, help: 'Run npm ci, or set TLS_CERT and TLS_KEY. Phone cameras require HTTPS.' }); }
      if (credentials) {
        certificates.ca = credentials.ca;
        info.caAvailable = !!credentials.ca;
        info.caFingerprint = credentials.ca ? new X509Certificate(credentials.ca).fingerprint256 : null;
        await listen(https.createServer({ cert: credentials.cert, key: credentials.key }, app.handle), httpsPort, 'https');
      }
    }
    await listen(http.createServer(app.handle), httpPort, 'http');
  } catch (error) { shutdown(error.message, 1); return; }
  logger('info', 'server.ready', {
    display: `http://localhost:${info.httpPort}/`,
    phones: info.https ? addresses.map(ip => `https://${ip}:${info.httpsPort}/phone`) : [],
    logDirectory: process.env.LOG_DIR || join(projectRoot, 'logs'),
  });
  console.log(`\nSmartShifting / Glint\nPC: http://localhost:${info.httpPort}/`);
  for (const ip of addresses) {
    console.log(`Phone setup: http://${ip}:${info.httpPort}/setup`);
    if (info.https) console.log(`Phone camera: https://${ip}:${info.httpsPort}/phone`);
  }
  if (!info.https) console.log('HTTPS could not start. See the warning above and README.md.');
  console.log('Keep this terminal open. Ctrl+C stops the server.\n');
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
