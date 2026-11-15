import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
function key() {
  const configured = process.env.EBAY_TOKEN_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured))
      throw new Error('eBay encryption configuration needs a 64-character hexadecimal key.');
    return Buffer.from(configured, 'hex');
  }
  const root = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!root) throw new Error('Private server credentials are not configured.');
  // Domain-separated encryption; a database-only leak cannot reveal server-held tokens.
  return Buffer.from(
    hkdfSync('sha256', root, 'thrift-log/integrations', 'ebay-token-encryption-v1', 32),
  );
}
export function seal(userId: string, value: string, purpose = 'token') {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(`ebay:v1:${userId}:${purpose}`));
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
    decipher.setAAD(Buffer.from(`ebay:v1:${userId}:${purpose}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Reconnect eBay to replace an unreadable credential.');
  }
}
export function stableId(...parts: string[]) {
  const h = createHash('sha256')
    .update(JSON.stringify(['ebay-v1', ...parts]))
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
