import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import https from 'node:https';
import { certificate } from '../certificate.mjs';
import { createApp } from '../server.mjs';

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), 'glint-certificate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('fresh clones generate a local CA and a matching HTTPS certificate without OpenSSL', async t => {
  const root = directory(t), addresses = ['192.168.10.12'];
  const credentials = await certificate({ root, addresses, env: {} });
  const ca = new X509Certificate(credentials.ca), leaf = new X509Certificate(credentials.cert);
  assert.equal(ca.ca, true); assert.equal(leaf.ca, false);
  assert.equal(leaf.verify(ca.publicKey), true);
  assert.equal(leaf.checkPrivateKey(createPrivateKey(credentials.key)), true);
  assert.equal(leaf.checkHost('localhost'), 'localhost');
  for (const ip of ['127.0.0.1', ...addresses]) assert.equal(leaf.checkIP(ip), ip);
  assert.ok(Date.parse(leaf.validTo) - Date.now() < 91 * 86400000);
  const reused = await certificate({ root, addresses, env: {} });
  assert.equal(new X509Certificate(reused.cert).fingerprint256, leaf.fingerprint256);
  assert.equal(new X509Certificate(reused.ca).fingerprint256, ca.fingerprint256);
});

test('LAN changes and expiring leaf certificates renew the leaf while retaining the trusted CA', async t => {
  const root = directory(t), now = Date.now();
  const first = await certificate({ root, addresses: ['192.168.10.12'], now, env: {} });
  const moved = await certificate({ root, addresses: ['192.168.10.14'], now, env: {} });
  assert.equal(new X509Certificate(moved.cert).checkIP('192.168.10.14'), '192.168.10.14');
  assert.notEqual(new X509Certificate(moved.cert).fingerprint256, new X509Certificate(first.cert).fingerprint256);
  const renewed = await certificate({ root, addresses: ['192.168.10.14'], now: now + 90 * 86400000, env: {} });
  assert.notEqual(new X509Certificate(renewed.cert).fingerprint256, new X509Certificate(moved.cert).fingerprint256);
  assert.deepEqual(renewed.ca, first.ca);
});

test('existing working certificates and explicitly configured certificates are preserved', async t => {
  const source = directory(t), root = directory(t), addresses = ['192.168.10.12'];
  const old = await certificate({ root: source, addresses, env: {} });
  mkdirSync(join(root, '.certs'));
  const certPath = join(root, '.certs', 'localhost-cert.pem'), keyPath = join(root, '.certs', 'localhost-key.pem');
  writeFileSync(certPath, old.cert); writeFileSync(keyPath, old.key);
  const reused = await certificate({ root, addresses, env: {} });
  assert.deepEqual(reused.cert, Buffer.from(old.cert)); assert.deepEqual(reused.key, Buffer.from(old.key)); assert.equal(reused.ca, null);
  const custom = await certificate({ root, addresses: ['10.0.0.5'], env: { TLS_CERT: certPath, TLS_KEY: keyPath } });
  assert.deepEqual(custom.cert, readFileSync(certPath)); assert.equal(custom.ca, null);
  await assert.rejects(certificate({ root, addresses, env: { TLS_CERT: certPath } }), /must be set together/);
});

test('generated HTTPS verifies against the local CA; setup serves only its public certificate', async t => {
  const root = directory(t), credentials = await certificate({ root, addresses: [], env: {} });
  const app = createApp({ certificates: { ca: credentials.ca } });
  const server = https.createServer({ cert: credentials.cert, key: credentials.key }, app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const get = path => new Promise((resolve, reject) => {
    https.get({ hostname: '127.0.0.1', port: server.address().port, path, ca: new X509Certificate(credentials.ca).toString() }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks), headers: response.headers }));
    }).on('error', reject);
  });
  assert.equal((await get('/phone')).status, 200);
  assert.match((await get('/setup')).body.toString(), /スマホを接続する/);
  const downloaded = await get('/setup/ca.crt');
  assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.body, credentials.ca);
  assert.equal(downloaded.headers['content-type'], 'application/x-x509-ca-cert');
  for (const path of ['/.certs/glint-ca-key.pem', '/.certs/localhost-key.pem']) assert.equal((await get(path)).status, 404);
});
