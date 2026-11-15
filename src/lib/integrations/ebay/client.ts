import 'server-only';
import { z } from 'zod';
import { config, EbayError, errors, EBAY_SCOPES, EBAY_FINANCE_SCOPE } from './config';
import { amountSchema } from './schema';
export const credentialsSchema = z.object({
  accessToken: z.string().min(1).max(12000),
  refreshToken: z.string().min(1).max(12000),
  expiresAt: z.number().int().positive(),
  scopes: z.array(z.string()).min(2).max(5),
});
export type Credentials = z.infer<typeof credentialsSchema>;
export async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new EbayError('response', errors.response);
  let bytes = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.length;
      if (bytes > 5_000_000) throw new EbayError('response', errors.response);
      parts.push(r.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } catch {
    throw new EbayError('response', errors.response);
  }
}
export async function exchangeToken(
  grant: { code: string } | { credentials: Credentials },
  financials = false,
): Promise<Credentials> {
  const c = config(),
    refresh = 'credentials' in grant,
    scopes = refresh
      ? grant.credentials.scopes
      : [...EBAY_SCOPES, ...(financials ? [EBAY_FINANCE_SCOPE] : [])],
    form = new URLSearchParams(
      refresh
        ? {
            grant_type: 'refresh_token',
            refresh_token: grant.credentials.refreshToken,
            scope: scopes.join(' '),
          }
        : { grant_type: 'authorization_code', code: grant.code, redirect_uri: c.redirect },
    );
  let response: Response;
  try {
    response = await fetch(c.api + '/identity/v1/oauth2/token', {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(c.clientId + ':' + c.secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
  } catch {
    throw new EbayError('provider', errors.provider);
  }
  if (!response.ok)
    throw new EbayError(
      response.status === 400 || response.status === 401 ? 'auth' : 'provider',
      response.status === 400 || response.status === 401 ? errors.auth : errors.provider,
      response.status === 400 || response.status === 401 ? 401 : 502,
    );
  const data = z
    .object({
      access_token: z.string().min(1).max(12000),
      refresh_token: z.string().min(1).max(12000).optional(),
      expires_in: z.number().int().positive().max(86400),
      token_type: z.string(),
      scope: z.string().optional(),
    })
    .safeParse(await boundedJson(response));
  if (
    !data.success ||
    data.data.token_type.toLowerCase() !== 'bearer' ||
    (!refresh && !data.data.refresh_token)
  )
    throw new EbayError('response', errors.response);
  if (data.data.scope && scopes.some((scope) => !data.data.scope!.split(' ').includes(scope)))
    throw new EbayError('permissions', errors.permissions, 403);
  return credentialsSchema.parse({
    accessToken: data.data.access_token,
    refreshToken: data.data.refresh_token || (refresh ? grant.credentials.refreshToken : ''),
    expiresAt: Date.now() + data.data.expires_in * 1000,
    scopes,
  });
}
export class EbayClient {
  constructor(
    readonly token: string,
    readonly environment = 'production',
  ) {}
  async get<T>(path: string, schema: z.ZodType<T>, query: Record<string, string> = {}): Promise<T> {
    if (!(
      /^\/sell\/fulfillment\/v1\/order(?:\/[A-Za-z0-9%._~-]+\/shipping_fulfillment)?$/.test(path) ||
      /^\/sell\/finances\/v1\/(transaction|payout)$/.test(path) ||
      path === '/commerce/identity/v1/user/'
    ))
      throw new EbayError('input', 'Unsupported eBay read operation.', 400);
    const base =
        this.environment === 'sandbox'
          ? 'https://api.sandbox.ebay.com'
          : path.startsWith('/sell/finances/')
            ? 'https://apiz.ebay.com'
            : 'https://api.ebay.com',
      url = new URL(path, base);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 3; attempt++) {
      let r: Response;
      try {
        r = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/json' },
        });
      } catch {
        if (attempt < 2) continue;
        throw new EbayError('provider', errors.provider);
      }
      if ((r.status === 429 || r.status >= 500) && attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(2000, Math.max(300, Number(r.headers.get('retry-after') || '1') * 1000)),
          ),
        );
        continue;
      }
      if (!r.ok) {
        const code =
          r.status === 401
            ? 'auth'
            : r.status === 403
              ? 'permissions'
              : r.status === 429
                ? 'rate'
                : 'provider';
        throw new EbayError(
          code,
          errors[code],
          r.status === 401 ? 401 : r.status === 403 ? 403 : 502,
        );
      }
      const result = schema.safeParse(await boundedJson(r));
      if (!result.success) throw new EbayError('response', errors.response);
      return result.data;
    }
    throw new EbayError('provider', errors.provider);
  }
}
export function cents(m: z.infer<typeof amountSchema>) {
  if (m.currency !== 'USD')
    throw new Error('Only USD is supported. No currency conversion is performed.');
  const sign = m.value.startsWith('-') ? -1 : 1,
    [whole, part = ''] = m.value.replace(/^-/, '').split('.');
  const result = sign * (Number(whole) * 100 + Number(part.padEnd(2, '0')));
  if (!Number.isSafeInteger(result) || Math.abs(result) > 100_000_000)
    throw new Error('The eBay amount exceeds the supported monetary limit.');
  return result;
}
