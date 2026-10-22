import { X509Certificate, createPrivateKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';

const DAY = 86400000;

function readPair(certPath, keyPath, now) {
  try {
    const cert = readFileSync(certPath), key = readFileSync(keyPath), x509 = new X509Certificate(cert);
    if (Date.parse(x509.validFrom) > now || Date.parse(x509.validTo) < now + DAY || !x509.checkPrivateKey(createPrivateKey(key))) return null;
    return { cert, key, x509 };
  } catch { return null; }
}

// Generated on this PC only. No OpenSSL executable or OS trust-store changes.
// Existing working certificates are reused, including the pre-cleanup format.
export async function certificate({ root, addresses, env = process.env, now = Date.now(), logger = () => {} }) {
  if (!!env.TLS_CERT !== !!env.TLS_KEY) throw new Error('TLS_CERT and TLS_KEY must be set together');
  if (env.TLS_CERT) return { cert: readFileSync(env.TLS_CERT), key: readFileSync(env.TLS_KEY), ca: null };
  const directory = join(root, '.certs');
  const certPath = join(directory, 'localhost-cert.pem'), keyPath = join(directory, 'localhost-key.pem');
  const caPath = join(directory, 'glint-ca.pem'), caKeyPath = join(directory, 'glint-ca-key.pem');
  const identity = ['localhost', '127.0.0.1', ...addresses].sort().join(',');
  const identityPath = join(directory, 'addresses.txt');
  let ca = readPair(caPath, caKeyPath, now);
  if (ca && (!ca.x509.ca || !ca.x509.verify(ca.x509.publicKey))) ca = null;
  const existing = readPair(certPath, keyPath, now);
  const coversAddresses = existing && existing.x509.checkHost('localhost') && ['127.0.0.1', ...addresses].every(ip => existing.x509.checkIP(ip));
  const existingCA = ca && existing && existing.x509.verify(ca.x509.publicKey);
  if (coversAddresses && (!existsSync(caPath) || existingCA)) {
    return { cert: existing.cert, key: existing.key, ca: existingCA ? ca.x509.raw : null };
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const notBeforeDate = new Date(now - 5 * 60000);
  if (!ca) {
    const generated = await generate([{ name: 'commonName', value: 'Glint Local Development CA' }], {
      keySize: 2048, algorithm: 'sha256', notBeforeDate, notAfterDate: new Date(now + 3 * 365 * DAY),
      extensions: [
        { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      ],
    });
    writeFileSync(caKeyPath, generated.private, { mode: 0o600 });
    writeFileSync(caPath, generated.cert);
    ca = { cert: generated.cert, key: generated.private, x509: new X509Certificate(generated.cert) };
    logger('info', 'https.ca.created', { fingerprint: ca.x509.fingerprint256 });
  }
  const generated = await generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048, algorithm: 'sha256', notBeforeDate, notAfterDate: new Date(now + 90 * DAY),
    ca: { cert: ca.cert.toString(), key: ca.key.toString() },
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...[...new Set(['127.0.0.1', ...addresses])].map(ip => ({ type: 7, ip }))] },
    ],
  });
  writeFileSync(keyPath, generated.private, { mode: 0o600 });
  writeFileSync(certPath, generated.cert);
  writeFileSync(identityPath, identity);
  logger('info', 'https.certificate.created', { addresses, expires: new Date(now + 90 * DAY).toISOString() });
  return { cert: generated.cert, key: generated.private, ca: ca.x509.raw };
}
