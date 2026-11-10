// Local certificates only. Does not install a root into any system trust store.
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { httpsPaths as paths, privateIPv4, wifiAddress } from './local-https.mjs';
const host = process.argv[2] || wifiAddress();
if (!host || !privateIPv4(host)) throw new Error('Pass your Mac’s private Wi-Fi IPv4 address.');
await mkdir(paths.directory, { recursive: true, mode: 0o700 });
await mkdir(paths.caDirectory, { recursive: true, mode: 0o700 });
const result = spawnSync(
  'mkcert',
  ['-cert-file', paths.cert, '-key-file', paths.key, host, 'localhost', '127.0.0.1', '::1'],
  {
    env: { ...process.env, CAROOT: paths.caDirectory },
    encoding: 'utf8',
  },
);
if (result.error || result.status !== 0)
  throw new Error('Install mkcert with brew install mkcert, then run this setup again.');
await chmod(paths.key, 0o600);
await chmod(paths.caDirectory + '/rootCA-key.pem', 0o600);
const ca = new X509Certificate(await readFile(paths.ca));
const cert = new X509Certificate(await readFile(paths.cert));
if (!cert.verify(ca.publicKey) || !cert.checkIP(host))
  throw new Error('Certificate verification failed.');
await writeFile(paths.iphoneCertificate, ca.raw, { mode: 0o644 });
await writeFile(
  paths.config,
  JSON.stringify({ host, port: 3000, caFingerprint: ca.fingerprint256 }, null, 2),
  { mode: 0o600 },
);
console.log(`HTTPS address: https://${host}:3000`);
console.log(`AirDrop only this public certificate to your iPhone: ${paths.iphoneCertificate}`);
console.log(`CA SHA-256: ${ca.fingerprint256}`);
console.log(
  'Install the certificate profile, then enable its SSL trust in iPhone Certificate Trust Settings.',
);
console.log('Private keys remain outside the repository. No Mac trust settings were changed.');
