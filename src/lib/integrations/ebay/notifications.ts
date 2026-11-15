import 'server-only';
import { createHash, createVerify } from 'node:crypto';
import { z } from 'zod';
import { config, appOrigin, EbayError } from './config';
import { boundedJson } from './client';
const keys = new Map<string, { key: string; until: number }>();
let misses = { since: Date.now(), count: 0 };
let applicationToken: { token: string; until: number; app: string } | null = null;
export function deletionChallenge(challenge: string) {
  const token = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN || '',
    origin = appOrigin();
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(token))
    throw new EbayError('setup', 'Configure the eBay account-deletion verification token.', 503);
  if (!challenge || challenge.length > 1000)
    throw new EbayError('input', 'Invalid verification challenge.', 400);
  return createHash('sha256')
    .update(challenge + token + origin + '/api/integrations/ebay/notifications')
    .digest('hex');
}
async function publicKey(kid: string) {
  const c = config(false),
    cacheId = c.environment + ':' + kid,
    cached = keys.get(cacheId);
  if (cached && cached.until > Date.now()) return cached.key;
  if (Date.now() - misses.since > 60000) misses = { since: Date.now(), count: 0 };
  if (++misses.count > 30)
    throw new EbayError(
      'rate',
      'Notification verification is temporarily rate limited. Retry later.',
      503,
    );
  const app = c.environment + ':' + c.clientId;
  if (
    !applicationToken ||
    applicationToken.app !== app ||
    applicationToken.until < Date.now() + 60000
  ) {
    const r = await fetch(c.api + '/identity/v1/oauth2/token', {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(c.clientId + ':' + c.secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
    });
    if (!r.ok)
      throw new EbayError('provider', 'Could not verify eBay notification credentials.', 503);
    const token = z
      .object({
        access_token: z.string().min(1).max(12000),
        expires_in: z.number().int().positive().max(86400),
      })
      .parse(await boundedJson(r));
    applicationToken = {
      app,
      token: token.access_token,
      until: Date.now() + token.expires_in * 1000,
    };
  }
  const r = await fetch(c.api + '/commerce/notification/v1/public_key/' + encodeURIComponent(kid), {
    method: 'GET',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + applicationToken.token, Accept: 'application/json' },
  });
  if (!r.ok) throw new EbayError('provider', 'Could not verify the eBay notification key.', 503);
  const parsed = z
    .object({ key: z.string().min(1).max(12000), algorithm: z.string(), digest: z.string() })
    .parse(await boundedJson(r));
  if (
    !['ECC', 'ECDSA'].includes(parsed.algorithm.toUpperCase()) ||
    !['SHA1', 'SHA-1'].includes(parsed.digest.toUpperCase())
  )
    throw new EbayError('signature', 'Unsupported eBay notification signature.', 412);
  if (keys.size >= 30) keys.clear();
  keys.set(cacheId, { key: parsed.key, until: Date.now() + 3600000 });
  return parsed.key;
}
export async function verifyDeletion(body: unknown, header: string) {
  if (!header || header.length > 4000)
    throw new EbayError('signature', 'Invalid eBay notification signature.', 412);
  let value;
  try {
    value = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new EbayError('signature', 'Invalid eBay notification signature.', 412);
  }
  const h = z
    .object({
      kid: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
      signature: z
        .string()
        .regex(/^[A-Za-z0-9+/]+=*$/)
        .max(2000),
    })
    .safeParse(value);
  if (!h.success) throw new EbayError('signature', 'Invalid eBay notification signature.', 412);
  const key = await publicKey(h.data.kid);
  let verified = false;
  try {
    const verifier = createVerify('SHA1');
    verifier.update(JSON.stringify(body));
    verifier.end();
    verified = verifier.verify(
      key
        .replace(/-----BEGIN PUBLIC KEY-----\s*/, '-----BEGIN PUBLIC KEY-----\n')
        .replace(/\s*-----END PUBLIC KEY-----/, '\n-----END PUBLIC KEY-----'),
      h.data.signature,
      'base64',
    );
  } catch {
    /* Never acknowledge an unverified deletion. */
  }
  if (!verified) throw new EbayError('signature', 'Invalid eBay notification signature.', 412);
  return z
    .object({
      metadata: z.object({ topic: z.literal('MARKETPLACE_ACCOUNT_DELETION') }),
      notification: z.object({
        notificationId: z.string().min(1).max(200),
        eventDate: z.iso.datetime({ offset: true }),
        data: z.object({ userId: z.string().min(1).max(200) }),
      }),
    })
    .parse(body);
}
