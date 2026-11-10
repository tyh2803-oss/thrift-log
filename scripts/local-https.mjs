import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
export const httpsDirectory = join(homedir(), 'Library', 'Application Support', 'Thrift Log HTTPS');
export const httpsPaths = {
  directory: httpsDirectory,
  caDirectory: join(httpsDirectory, 'ca'),
  ca: join(httpsDirectory, 'ca', 'rootCA.pem'),
  cert: join(httpsDirectory, 'lan-cert.pem'),
  key: join(httpsDirectory, 'lan-key.pem'),
  config: join(httpsDirectory, 'config.json'),
  iphoneCertificate: join(homedir(), 'Downloads', 'Thrift-Log-Local-CA.cer'),
};
export function privateIPv4(host) {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function wifiAddress() {
  const interfaces = networkInterfaces();
  const choices = [...(interfaces.en0 || []), ...Object.values(interfaces).flat()];
  return choices.find((a) => a.family === 'IPv4' && !a.internal && privateIPv4(a.address))?.address;
}
export async function localHttpsConfig() {
  return JSON.parse(await readFile(httpsPaths.config, 'utf8'));
}
