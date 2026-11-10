// Isolated HTTPS fixture server. Never use the real owner's account here.
import next from 'next';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { httpsPaths, localHttpsConfig } from './local-https.mjs';
if (!/^thrift-https-[a-f0-9-]+@example\.invalid$/.test(process.env.OWNER_EMAIL || ''))
  throw new Error('Use a disposable HTTPS-test owner.');
const { host } = await localHttpsConfig();
const port = 3156;
const app = next({ dev: false, hostname: host, port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(
  {
    key: await readFile(httpsPaths.key),
    cert: await readFile(httpsPaths.cert),
    minVersion: 'TLSv1.2',
  },
  (request, response) => {
    if (request.headers.host !== `${host}:${port}`) {
      response.writeHead(421).end();
      return;
    }
    // Set from this HTTPS-only listener, never from untrusted client forwarding headers.
    request.headers['x-forwarded-proto'] = 'https';
    handle(request, response);
  },
);
server.listen(port, host, () => console.log('Isolated HTTPS fixture ready.'));
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
