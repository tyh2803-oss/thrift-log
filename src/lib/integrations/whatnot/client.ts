import 'server-only';
import { z } from 'zod';
import { WHATNOT_BASE, pageSchema } from './schema';
export class WhatnotError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
export const errorMessages: Record<string, string> = {
  auth: 'Whatnot authorization expired or was revoked. Replace your personal token.',
  scope: 'The Whatnot token needs the documented read permissions.',
  rate: 'Whatnot is rate limiting this account. Sync will retry later.',
  provider: 'Whatnot could not be reached. Your saved progress is preserved.',
  response: 'Whatnot returned an unsupported response. Saved records were preserved.',
  budget: 'Sync will continue from its saved progress.',
  conflict: 'Your workspace changed. Sync will retry against the latest records.',
  credential: 'Reconnect Whatnot to replace its stored credential.',
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function boundedText(response: Response, limit: number) {
  if (!response.body) throw new WhatnotError('response', errorMessages.response);
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let count = 0,
    result = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > limit) {
        await reader.cancel();
        throw new Error();
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } catch {
    throw new WhatnotError(
      'response',
      'This Whatnot response is too large or unreadable. Use a smaller report.',
    );
  }
}
export class WhatnotClient {
  private nextRequest = 0;
  private requests = 0;
  constructor(
    private token: string,
    private fetcher: typeof fetch = fetch,
    private wait = pause,
    private deadline = Date.now() + 25_000,
  ) {}
  async get<T extends z.ZodType>(
    path: string,
    schema: T,
    query: Record<string, string> = {},
  ): Promise<z.infer<T>> {
    if (
      !/^\/(?:users\/me|orders(?:\/[1-9][0-9]{0,18}(?:\/items)?)?|shipments(?:\/[1-9][0-9]{0,18})?|shows(?:\/[a-f0-9-]{36})?|analytics\/shows\/[a-f0-9-]{36}|reports(?:\/[a-f0-9-]{36})?)$/.test(
        path,
      )
    )
      throw new WhatnotError('response', 'Unsupported read-only Whatnot operation.');
    const url = new URL(WHATNOT_BASE + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++this.requests > 80 || Date.now() > this.deadline - 1000)
        throw new WhatnotError('budget', errorMessages.budget, 429);
      if (this.nextRequest > this.deadline - 1000)
        throw new WhatnotError('rate', errorMessages.rate, 429);
      await this.wait(Math.max(0, this.nextRequest - Date.now()));
      this.nextRequest = Date.now() + 160;
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.max(500, Math.min(10_000, this.deadline - Date.now()))),
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        });
      } catch {
        throw new WhatnotError('provider', errorMessages.provider);
      }
      if (response.status === 401) throw new WhatnotError('auth', errorMessages.auth, 401);
      if (response.status === 403) throw new WhatnotError('scope', errorMessages.scope, 403);
      if (response.status === 429 || response.status >= 500) {
        const retry = Number(
          response.headers.get('retry-after') || response.headers.get('ratelimit-reset') || 1,
        );
        const delay =
          Math.max(1, Number.isFinite(retry) ? retry : 1) * 1000 * 2 ** attempt +
          Math.floor(Math.random() * 100);
        if (attempt === 2 || Date.now() + delay > this.deadline - 1000)
          throw new WhatnotError(
            response.status === 429 ? 'rate' : 'provider',
            errorMessages[response.status === 429 ? 'rate' : 'provider'],
            response.status === 429 ? 429 : 502,
          );
        await this.wait(delay);
        continue;
      }
      if (response.status === 404)
        throw new WhatnotError('not_found', 'This Whatnot resource is not available.', 404);
      if (!response.ok) throw new WhatnotError('response', errorMessages.response);
      if (response.headers.get('ratelimit-remaining') === '0')
        this.nextRequest =
          Date.now() + Math.max(1, Number(response.headers.get('ratelimit-reset')) || 1) * 1000;
      try {
        return schema.parse(JSON.parse(await boundedText(response, 2_000_000)));
      } catch (e) {
        if (e instanceof WhatnotError) throw e;
        throw new WhatnotError('response', errorMessages.response);
      }
    }
    throw new WhatnotError('provider', errorMessages.provider);
  }
  page<T extends z.ZodType>(
    path: string,
    schema: T,
    cursor: string | null = null,
    query: Record<string, string> = {},
  ) {
    return this.get(path, pageSchema(schema), {
      limit: '5',
      ...query,
      ...(cursor ? { cursor } : {}),
    }).then((page) => {
      if (cursor && page.next_cursor === cursor)
        throw new WhatnotError(
          'response',
          'Whatnot repeated its pagination cursor. Try sync again later.',
        );
      return page;
    });
  }
  async all<T extends z.ZodType>(path: string, schema: T) {
    const result: z.infer<T>[] = [],
      seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const next: { data: z.infer<T>[]; next_cursor: string | null } = await this.page(
        path,
        schema,
        cursor,
        { limit: '50' },
      );
      result.push(...next.data);
      if (!next.next_cursor) return result;
      if (seen.has(next.next_cursor))
        throw new WhatnotError(
          'response',
          'Whatnot repeated its pagination cursor. Try sync again later.',
        );
      seen.add(next.next_cursor);
      cursor = next.next_cursor;
    }
    throw new WhatnotError('response', 'This order has too many item pages. Review it in Whatnot.');
  }
}
export function reportDownloadAllowed(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      (u.hostname === 'storage.googleapis.com' ||
        /^[a-z0-9.-]+\.storage\.googleapis\.com$/.test(u.hostname) ||
        /^[a-z0-9.-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname) ||
        /^(?:reports|storage|cdn)\.whatnot\.com$/.test(u.hostname))
    );
  } catch {
    return false;
  }
}
export async function downloadReport(url: string, fetcher: typeof fetch = fetch) {
  if (!reportDownloadAllowed(url))
    throw new WhatnotError(
      'response',
      'Whatnot supplied an unrecognized report download host. Keep the report for manual import and contact the administrator.',
    );
  // Presigned URLs are already credentials. Never forward the Whatnot Bearer token or follow redirects.
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new WhatnotError(
      'provider',
      'The report download could not connect. Refresh its source report and retry.',
    );
  }
  if (!response.ok)
    throw new WhatnotError(
      'provider',
      'This Whatnot report download expired or is unavailable. Refresh the report in Whatnot and sync again.',
    );
  return boundedText(response, 10_000_000);
}
