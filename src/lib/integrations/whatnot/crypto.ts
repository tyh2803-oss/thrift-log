import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  createHash,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
function key() {
  const configured = process.env.WHATNOT_TOKEN_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured))
      throw new Error('Whatnot encryption configuration needs a 64-character hexadecimal key.');
    return Buffer.from(configured, 'hex');
  }
  const root = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!root) throw new Error('Private server credentials are not configured.');
  // Domain-separated encryption; a database-only leak cannot reveal server-held tokens.
  return Buffer.from(
    hkdfSync('sha256', root, 'thrift-log/integrations', 'whatnot-token-encryption-v1', 32),
  );
}
export function seal(userId: string, value: string, purpose = 'token') {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`whatnot:v1:${userId}:${purpose}`));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}
export function unseal(userId: string, value: string, purpose = 'token') {
  try {
    const [version, iv, tag, body, ...extra] = value.split('.');
    if (version !== 'v1' || extra.length || !body) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`whatnot:v1:${userId}:${purpose}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Reconnect Whatnot to replace an unreadable credential.');
  }
}
export function stableId(...parts: string[]) {
  const h = createHash('sha256')
    .update(JSON.stringify(['whatnot-v1', ...parts]))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const payloadHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
export function webhookKey(secret: string) {
  const encoded = secret.replace(/^wn_wh_/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error('Use the webhook signing secret from Whatnot.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 16 || bytes.length > 128)
    throw new Error('Use the webhook signing secret from Whatnot.');
  return bytes;
}
export function verifyWebhook(secret: string, body: string, headers: Headers, now = Date.now()) {
  const id = headers.get('webhook-id') || '',
    time = headers.get('webhook-timestamp') || '';
  if (
    !/^[A-Za-z0-9._-]{1,200}$/.test(id) ||
    !/^\d{1,12}$/.test(time) ||
    Math.abs(now / 1000 - Number(time)) > 300
  )
    return false;
  const expected = createHmac('sha256', webhookKey(secret))
    .update(`${id}.${time}.${body}`)
    .digest();
  return (headers.get('webhook-signature') || '').split(' ').some((signature) => {
    const [version, value] = signature.split(',');
    if (version !== 'v1' || !value) return false;
    const actual = Buffer.from(value, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
