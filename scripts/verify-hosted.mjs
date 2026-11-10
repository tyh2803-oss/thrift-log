// Explicit hosted integration check. Uses .env.local; never logs keys, sessions, or records.
// Run a separate local app first, then:
// node --env-file=.env.local scripts/verify-hosted.mjs
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readConfiguration, secureSessionCookie } from '../src/lib/supabase/config.ts';

const config = readConfiguration(process.env);
const origin = process.env.THRIFT_LOG_VERIFY_URL || 'http://127.0.0.1:3100';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
  throw new Error('The integration check requires a loopback app URL.');
if (new URL(config.url).hostname !== 'gvwgasebholdawlakwdf.supabase.co')
  throw new Error('The integration check requires the verified Thrift Log project.');
const admin = createClient(config.url, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicClient = () =>
  createClient(config.url, config.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
let stage = 'initialization';
let owner,
  ownerSession,
  otherSession,
  otherId,
  baseline,
  baselineLoaded = false;
let lastRevision = null;
let otherSignedOut = false;
const itemId = randomUUID();
const listingIds = [randomUUID(), randomUUID()];
const photos = [];
let passed = true;
class CheckFailure extends Error {}
function check(name, condition, code) {
  if (!condition) {
    const safeCode =
      typeof code === 'string' && /^[A-Za-z0-9_]{1,50}$/.test(code) ? ` [${code}]` : '';
    throw new CheckFailure(name + safeCode);
  }
  console.log(`PASS ${name}`);
}
function ok(result, name) {
  check(name, !result.error, result.error?.code);
  return result.data;
}
function cookieClient(jar) {
  return createServerClient(config.url, config.publicKey, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: true, path: '/' },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) =>
        values.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
}
async function sessionJar(session) {
  const jar = new Map();
  ok(
    await cookieClient(jar).auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
    'Real Auth session serialized into SSR cookies',
  );
  return jar;
}
async function request(path, { jar = new Map(), method = 'GET', body, source = origin } = {}) {
  const headers = { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (method !== 'GET') headers.Origin = source;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + path, {
    method,
    headers,
    redirect: 'manual',
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0],
      pos = pair.indexOf('=');
    const key = pair.slice(0, pos),
      value = pair.slice(pos + 1);
    if (value) jar.set(key, value);
    else jar.delete(key);
  }
  return response;
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) =>
  JSON.stringify(value, (key, v) => {
    if (key === 'revision') return undefined;
    if (Array.isArray(v))
      return [...v].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    return v;
  });
try {
  stage = 'owner account lookup';
  for (let page = 1; page <= 100 && !owner; page++) {
    const data = ok(
      await admin.auth.admin.listUsers({ page, perPage: 100 }),
      'Auth admin account lookup',
    );
    owner = data.users.find((u) => u.email?.toLowerCase() === config.ownerEmail);
    if (data.users.length < 100) break;
  }
  check('Configured owner account is confirmed', !!owner?.email_confirmed_at);
  baseline = ok(
    await admin.rpc('load_workspace', { p_user_id: owner.id }),
    'Existing workspace baseline read',
  );
  baselineLoaded = true;
  stage = 'signed-out and credential rejection';
  check('Signed-out workspace denied', (await request('/api/workspace')).status === 401);
  check(
    'Signed-out photo read denied',
    (await request('/api/photos?path=unavailable.png')).status === 404,
  );
  check(
    'Invalid owner password rejected',
    (
      await request('/api/auth', {
        method: 'POST',
        body: {
          action: 'signin',
          email: config.ownerEmail,
          password: randomBytes(30).toString('base64url'),
        },
      })
    ).status === 400,
  );
  stage = 'owner Auth session';
  const link = ok(
    await admin.auth.admin.generateLink({ type: 'magiclink', email: config.ownerEmail }),
    'Owner one-time test link generated without sending email',
  );
  check('Test link belongs to existing owner', link.user.id === owner.id);
  const ownerAuth = publicClient();
  ownerSession = ok(
    await ownerAuth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' }),
    'Owner authenticated by real Supabase Auth',
  ).session;
  const jar = await sessionJar(ownerSession);
  check(
    'Owner token verified by Auth',
    (await ownerAuth.auth.getUser()).data.user?.id === owner.id,
  );
  let response = await request('/api/workspace', { jar });
  check('Authenticated workspace route available', response.status === 200);
  check(
    'Private workspace response is not cached',
    response.headers.get('cache-control')?.includes('no-store'),
  );
  let workspace = await response.json();
  stage = 'session refresh';
  const baseName = [...jar.keys()].find((k) => /-auth-token(?:\.0)?$/.test(k))?.replace(/\.0$/, '');
  check('SSR authentication cookie present', !!baseName);
  const keys = [...jar.keys()]
    .filter((k) => k === baseName || k.startsWith(baseName + '.'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const encoded = keys.map((k) => jar.get(k)).join('');
  check('SSR session uses encoded cookies', encoded.startsWith('base64-'));
  const cookieSession = JSON.parse(Buffer.from(encoded.slice(7), 'base64url').toString());
  cookieSession.expires_at = Math.floor(Date.now() / 1000) - 60;
  keys.forEach((k) => jar.delete(k));
  const expired = 'base64-' + Buffer.from(JSON.stringify(cookieSession)).toString('base64url');
  for (let i = 0; i < expired.length; i += 3000)
    jar.set(baseName + '.' + Math.floor(i / 3000), expired.slice(i, i + 3000));
  response = await request('/api/workspace', { jar });
  check(
    'Proxy refreshes expired session metadata through real Auth',
    response.status === 200 && response.headers.getSetCookie().length > 0,
  );
  check(
    'Refreshed cookies are HttpOnly, SameSite=Lax, and use the correct transport',
    response.headers
      .getSetCookie()
      .filter((v) => !v.includes('Max-Age=0'))
      .every(
        (v) =>
          /HttpOnly/i.test(v) &&
          /SameSite=lax/i.test(v) &&
          /Secure/i.test(v) === secureSessionCookie(new Request(origin)),
      ),
  );
  workspace = await response.json();
  stage = 'private photo upload';
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'image/png' }), 'verification.png');
  response = await request('/api/photos', { jar, method: 'POST', body: form });
  if (response.status !== 200) {
    const error = await response
      .clone()
      .json()
      .catch(() => ({}));
    const known = [
      'Invalid request origin',
      'Unauthorized',
      'Upload an image smaller than 5 MB.',
      'Use a JPEG, PNG, or WebP image.',
      'Photo upload failed. Check the private storage bucket.',
    ];
    if (known.includes(error.error)) console.error(`Photo route diagnostic: ${error.error}`);
  }
  check('App uploads actual PNG bytes to private Storage', response.status === 200);
  const { path } = await response.json();
  photos.push(path);
  check(
    'Uploaded photo uses owner directory',
    path.startsWith(owner.id + '/') && path.endsWith('.png'),
  );
  response = await request('/api/photos?path=' + encodeURIComponent(path), { jar });
  check(
    'App authorizes a temporary photo URL without caching',
    response.status === 307 && response.headers.get('cache-control')?.includes('no-store'),
  );
  const signed = await fetch(response.headers.get('location'));
  check(
    'Signed photo download matches uploaded bytes',
    signed.ok && digest(Buffer.from(await signed.arrayBuffer())) === digest(bytes),
  );
  const badForm = new FormData();
  badForm.set('file', new Blob(['not an image'], { type: 'image/png' }), 'invalid.png');
  check(
    'Mislabeled non-image upload rejected',
    (await request('/api/photos', { jar, method: 'POST', body: badForm })).status === 400,
  );
  check(
    'Cross-origin upload rejected',
    (
      await request('/api/photos', {
        jar,
        method: 'POST',
        body: form,
        source: 'https://invalid.example',
      })
    ).status === 400,
  );
  stage = 'inventory persistence';
  const now = new Date().toISOString();
  const item = {
    id: itemId,
    sku: 'VERIFY-' + itemId,
    title: 'Temporary hosted verification',
    cost: 1250,
    asking: 4000,
    purchasedAt: now,
    createdAt: now,
    status: 'Purchased',
    photos: [path],
  };
  response = await request('/api/workspace', {
    jar,
    method: 'POST',
    body: { revision: workspace.revision, commands: [{ type: 'item', value: item }] },
  });
  check('Inventory saved through authenticated app route', response.status === 200);
  workspace = await response.json();
  lastRevision = workspace.revision;
  const reloaded = await request('/api/workspace', { jar: new Map(jar) });
  check(
    'Fresh request reloads durable item and photo reference',
    reloaded.status === 200 &&
      (await reloaded.json()).items.some(
        (i) => i.id === itemId && i.photos[0] === path && i.cost === 1250,
      ),
  );
  const stored = ok(
    await admin
      .from('items')
      .select('id,cost,photos')
      .eq('user_id', owner.id)
      .eq('id', itemId)
      .single(),
    'Independent database read confirms inventory commit',
  );
  check(
    'Inventory and photo reference persisted in hosted database',
    stored.cost === 1250 && stored.photos[0] === path,
  );
  response = await request('/api/workspace', {
    jar,
    method: 'POST',
    body: {
      revision: workspace.revision,
      commands: listingIds.map((id, i) => ({
        type: 'listing',
        value: {
          id,
          itemId,
          marketplace: i ? 'eBay' : 'Whatnot',
          price: 4000,
          originalPrice: 4000,
          listedAt: now,
          status: 'Active',
        },
      })),
    },
  });
  check('Two listings saved for one physical item', response.status === 200);
  workspace = await response.json();
  lastRevision = workspace.revision;
  check(
    'Cross-listing keeps one inventory record',
    workspace.items.filter((i) => i.id === itemId).length === 1 &&
      workspace.listings.filter((l) => l.itemId === itemId).length === 2,
  );
  response = await request('/api/workspace', {
    jar,
    method: 'POST',
    body: {
      revision: workspace.revision,
      commands: [
        { type: 'item', value: { ...workspace.items.find((i) => i.id === itemId), cost: 1350 } },
      ],
    },
  });
  check('Inventory update persists', response.status === 200);
  workspace = await response.json();
  lastRevision = workspace.revision;
  check(
    'Stale revision rejected',
    (
      await request('/api/workspace', {
        jar,
        method: 'POST',
        body: { revision: 0, commands: [{ type: 'item', value: item }] },
      })
    ).status === 409,
  );
  const ownerRead = ok(
    await ownerAuth.from('items').select('id').eq('id', itemId),
    'Owner RLS SELECT succeeds',
  );
  check('Owner sees their test item', ownerRead.length === 1);
  const deniedWrite = await ownerAuth
    .from('items')
    .update({ title: 'must not write' })
    .eq('id', itemId);
  check('Authenticated direct table write denied', deniedWrite.error?.code === '42501');
  const deniedRpc = await ownerAuth.rpc('load_workspace', { p_user_id: owner.id });
  check('Authenticated direct workspace RPC denied', !!deniedRpc.error);
  stage = 'cross-account isolation';
  const email = 'thrift-log-verification-' + randomUUID() + '@example.invalid';
  const password = randomBytes(36).toString('base64url');
  const other = ok(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'Disposable isolation account created without email delivery',
  );
  otherId = other.user.id;
  const otherAuth = publicClient();
  otherSession = ok(
    await otherAuth.auth.signInWithPassword({ email, password }),
    'Real password authentication succeeds for disposable account',
  ).session;
  const otherJar = await sessionJar(otherSession);
  check(
    'Wrong-owner password sign-in blocked by app',
    (await request('/api/auth', { method: 'POST', body: { action: 'signin', email, password } }))
      .status === 400,
  );
  check(
    'Wrong-owner real session cannot read app workspace',
    (await request('/api/workspace', { jar: otherJar })).status === 401,
  );
  check(
    'Wrong-owner session cannot read app photo',
    (await request('/api/photos?path=' + encodeURIComponent(path), { jar: otherJar })).status ===
      404,
  );
  const isolated = ok(
    await otherAuth.from('items').select('id').eq('id', itemId),
    'Second-account RLS read executes',
  );
  check('Second account cannot see owner inventory', isolated.length === 0);
  check(
    'Second account cannot download private object',
    !!(await otherAuth.storage.from('inventory-photos').download(path)).error,
  );
  check(
    'Anonymous client cannot download private object',
    !!(await publicClient().storage.from('inventory-photos').download(path)).error,
  );
  check(
    'Owner authenticated Storage download succeeds',
    !(await ownerAuth.storage.from('inventory-photos').download(path)).error,
  );
  const deniedPath = owner.id + '/denied-' + randomUUID() + '.png';
  photos.push(deniedPath); // Clean up even if an unexpectedly broad policy lets this succeed.
  check(
    'Direct owner Storage upload denied',
    !!(
      await ownerAuth.storage
        .from('inventory-photos')
        .upload(deniedPath, bytes, { contentType: 'image/png' })
    ).error,
  );
  const outsiderUpload = new FormData();
  outsiderUpload.set('file', new Blob([bytes], { type: 'image/png' }), 'verification.png');
  check(
    'Wrong-owner upload blocked by app',
    (await request('/api/photos', { jar: otherJar, method: 'POST', body: outsiderUpload }))
      .status === 400,
  );
  check(
    'App sign-out succeeds for disposable session',
    (await request('/api/auth', { jar: otherJar, method: 'POST', body: { action: 'signout' } }))
      .status === 200,
  );
  otherSignedOut = true;
  check(
    'Sign-out revokes the real refresh token',
    !!(await publicClient().auth.refreshSession({ refresh_token: otherSession.refresh_token }))
      .error,
  );
  check(
    'Signed-out session cannot access workspace',
    (await request('/api/workspace', { jar: otherJar })).status === 401,
  );
  check(
    'Signed-out session cannot access photo',
    (await request('/api/photos?path=' + encodeURIComponent(path), { jar: otherJar })).status ===
      404,
  );
  check(
    'Owner data survives all unauthorized requests',
    (await request('/api/workspace', { jar })).status === 200,
  );
} catch (error) {
  passed = false;
  // Only our fixed check names and sanitized status codes reach stdout.
  const message =
    error instanceof CheckFailure
      ? error.message
      : 'Hosted check failed; inspect the current stage without logging credentials';
  console.error(`FAIL ${stage}: ${message}`);
} finally {
  const cleanup = async (name, action) => {
    try {
      const result = await action();
      check(name, !result?.error, result?.error?.code);
    } catch {
      passed = false;
      console.error(`FAIL ${name}`);
    }
  };
  if (owner) {
    await cleanup('Temporary listing rows removed', () =>
      admin.from('listings').delete().eq('user_id', owner.id).in('id', listingIds),
    );
    await cleanup('Temporary inventory row removed', () =>
      admin.from('items').delete().eq('user_id', owner.id).eq('id', itemId),
    );
    if (photos.length)
      await cleanup('Temporary photo bytes removed', () =>
        admin.storage.from('inventory-photos').remove(photos),
      );
    if (baselineLoaded)
      await cleanup('Existing workspace records preserved', async () => {
        let result = await admin.rpc('load_workspace', { p_user_id: owner.id });
        if (result.error) return result;
        if (baseline === null && result.data) {
          const hasRecords = Object.values(result.data).some(
            (v) => Array.isArray(v) && v.length > 0,
          );
          if (!hasRecords && result.data.revision === lastRevision) {
            const removed = await admin
              .from('workspaces')
              .delete()
              .eq('user_id', owner.id)
              .eq('revision', lastRevision);
            if (removed.error) return removed;
            result = await admin.rpc('load_workspace', { p_user_id: owner.id });
          }
        }
        if (canonical(result.data) !== canonical(baseline))
          return { error: { code: 'BASELINE_CHANGED' } };
        return result;
      });
  }
  if (ownerSession)
    await cleanup('Only the owner test session revoked', () =>
      admin.auth.admin.signOut(ownerSession.access_token, 'local'),
    );
  if (otherSession && !otherSignedOut)
    await cleanup('Disposable account sessions revoked', () =>
      admin.auth.admin.signOut(otherSession.access_token, 'local'),
    );
  if (otherId)
    await cleanup('Disposable isolation account deleted', () =>
      admin.auth.admin.deleteUser(otherId),
    );
  console.log(
    passed
      ? 'PASS All hosted checks and cleanup completed'
      : 'FAIL Hosted checks incomplete; review reported stages',
  );
  process.exitCode = passed ? 0 : 1;
}
