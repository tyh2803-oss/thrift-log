import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { httpsPaths, localHttpsConfig } from './local-https.mjs';
let config;
try {
  config = await localHttpsConfig();
} catch {
  throw new Error('Run npm run https:setup first.');
}
const certificate = new X509Certificate(await readFile(httpsPaths.cert));
if (
  !certificate.checkIP(config.host) ||
  !Object.values(networkInterfaces())
    .flat()
    .some((a) => a.address === config.host)
)
  throw new Error('Your Wi-Fi address changed. Run npm run https:setup with the new address.');
console.log(`iPhone URL: https://${config.host}:${config.port}`);
console.log('The iPhone must trust the exported local CA before opening this address.');
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/next/dist/bin/next'),
    'dev',
    '--hostname',
    '0.0.0.0',
    '--port',
    String(config.port),
    '--experimental-https',
    '--experimental-https-key',
    httpsPaths.key,
    '--experimental-https-cert',
    httpsPaths.cert,
  ],
  { stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
