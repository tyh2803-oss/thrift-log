// Real isolated Auth/Storage/financial persistence with deterministic extraction fixtures.
// Never sends business images to OpenAI or touches the configured owner's records.
import { createClient } from '@supabase/supabase-js';
import { webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { readConfiguration } from '../src/lib/supabase/config.ts';
const config = readConfiguration(process.env);
if (new URL(config.url).hostname !== 'gvwgasebholdawlakwdf.supabase.co')
  throw new Error('Use the verified Thrift Log project.');
const admin = createClient(config.url, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `thrift-assistant-${randomUUID()}@example.invalid`,
  password = randomBytes(36).toString('base64url');
const origin = 'http://127.0.0.1:3152';
let userId,
  browser,
  server,
  context,
  token,
  passed = true,
  stage = 'setup';
const paths = new Set();
class CheckFailure extends Error {}
function check(name, condition) {
  if (!condition) throw new CheckFailure(name);
  console.log(`PASS ${name}`);
}
const now = Date.now(),
  saleDay = new Date(now - 86400000).toISOString().slice(0, 10),
  purchased = new Date(now - 7 * 86400000).toISOString();
const line = (patch = {}) => ({
  title: 'Fixture Carhartt jacket',
  brand: 'Carhartt',
  size: 'L',
  color: 'Blue',
  category: null,
  condition: null,
  description: null,
  sku: null,
  externalProductId: null,
  listingId: null,
  url: null,
  price: 4500,
  ...patch,
});
const record = (patch = {}) => ({
  kind: 'sale',
  marketplace: 'Vinted',
  currency: 'USD',
  status: 'completed',
  date: saleDay,
  externalOrderId: 'fixture-order',
  lines: [line({ listingId: 'fixture-vinted' })],
  fees: 400,
  processing: 0,
  shipping: 300,
  shippingCollected: 0,
  discount: 0,
  refund: 0,
  other: 0,
  warnings: [],
  ...patch,
});
async function workspace() {
  const r = await context.request.get(origin + '/api/workspace');
  check('Authenticated workspace reload', r.ok());
  return r.json();
}
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  check('Disposable assistant account created', !created.error && !!created.data.user);
  userId = created.data.user.id;
  stage = 'isolated production app';
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3152'],
    { env: { ...process.env, OWNER_EMAIL: email, OPENAI_API_KEY: '' }, stdio: 'ignore' },
  );
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    if (server.exitCode !== null) break;
    try {
      ready = (await fetch(origin + '/login')).ok;
    } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('Isolated assistant app ready', ready);
  stage = 'WebKit launch';
  browser = await webkit.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  stage = 'password form';
  await page.goto(origin + '/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  stage = 'password navigation';
  await page.waitForURL(origin + '/', { timeout: 15000 });
  check('WebKit private workspace sign-in', true);
  stage = 'fixture inventory setup';
  const itemId = randomUUID();
  const initial = await workspace();
  const listings = ['Vinted', 'Depop'].map((marketplace) => ({
    type: 'listing',
    value: {
      id: randomUUID(),
      itemId,
      marketplace,
      price: 5500,
      originalPrice: 5500,
      externalId: marketplace === 'Vinted' ? 'fixture-vinted' : 'fixture-depop',
      url: '',
      listedAt: purchased,
      status: 'Active',
      format: 'Fixed price',
      lastSync: null,
    },
  }));
  const seeded = await context.request.post(origin + '/api/workspace', {
    headers: { Origin: origin },
    data: {
      revision: initial.revision,
      commands: [
        {
          type: 'item',
          value: {
            id: itemId,
            sku: 'FIXTURE-JACKET',
            title: 'Fixture Carhartt jacket',
            brand: 'Carhartt',
            size: 'L',
            color: 'Blue',
            cost: 1200,
            asking: 5500,
            purchasedAt: purchased,
            createdAt: purchased,
            status: 'Listed',
          },
        },
        ...listings,
      ],
    },
  });
  check('Disposable inventory fixture saved through existing commands', seeded.ok());
  await page.reload();
  let records = [];
  // Stub extraction at the actual browser FormData boundary. WebKit protocol
  // interception may omit file bytes, which would produce the wrong source hash.
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).startsWith('/api/assistant/extract')) {
        if (!init?.method || init.method === 'GET')
          return Response.json({ enabled: true, batchLimit: 10 });
        const image = init.body.get('images');
        const digest = await crypto.subtle.digest('SHA-256', await image.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        return Response.json({
          screenshots: [
            {
              hash,
              name: 'fixture.jpg',
              extraction: {
                records: window.__thriftAssistantFixtures,
                message: 'Deterministic test extraction fixture.',
              },
            },
          ],
        });
      }
      return originalFetch(input, init);
    };
  });
  const png = async (color) =>
    sharp({ create: { width: 2, height: 2, channels: 3, background: color } })
      .png()
      .toBuffer();
  const listingImage = await png('#ff0000'),
    saleImage = await png('#0000ff');
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  stage = 'listing review and approval';
  records = [
    record({
      kind: 'listing',
      status: 'active',
      externalOrderId: null,
      lines: [line({ listingId: 'fixture-vinted', price: 4800 })],
    }),
    record({
      kind: 'listing',
      status: 'active',
      externalOrderId: null,
      marketplace: 'Depop',
      lines: [
        line({
          title: 'Fixture red boots',
          brand: 'Other',
          size: '7',
          color: 'Red',
          listingId: 'fixture-boots',
          price: 6000,
        }),
      ],
    }),
  ];
  await page.evaluate((data) => {
    window.__thriftAssistantFixtures = data;
  }, records);
  await dialog
    .getByLabel('Screenshot files')
    .setInputFiles({ name: 'fixture-listings.png', mimeType: 'image/png', buffer: listingImage });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const second = dialog.locator('.assistant-extraction').nth(1);
  await second.getByRole('button', { name: 'Edit', exact: true }).click();
  await second.getByRole('button', { name: 'Create new physical item' }).click();
  await second.getByLabel('Purchase cost, line 1 ($)', { exact: true }).fill('15');
  await second.getByLabel('Acquisition date, line 1', { exact: true }).fill(purchased.slice(0, 10));
  await second.getByText('I checked inventory and confirm this is a new physical item.').click();
  check(
    'No business records written during screenshot review',
    (await workspace()).items.length === 1,
  );
  stage = 'listing ready-count after required fields';
  await dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }).click();
  stage = 'listing database confirmation';
  await dialog.getByText(/Saved 2 approved records/).waitFor({ timeout: 20000 });
  let saved = await workspace();
  saved.imports.forEach((i) => {
    const reference = JSON.parse(i.rawCsv).screenshot.reference;
    if (reference) paths.add(reference);
  });
  check(
    'Hosted listing update and new inventory persisted together',
    saved.items.length === 2 &&
      saved.listings.length === 3 &&
      saved.listings.find((l) => l.externalId === 'fixture-vinted')?.price === 4800 &&
      saved.orders.length === 0,
  );
  check(
    'Hosted inventory cost counts physical pieces once',
    saved.items.reduce((n, i) => n + i.cost, 0) === 2700,
  );
  check('Private original screenshot is referenced once for both listing rows', paths.size === 1);
  stage = 'sale review and approval';
  records = [record()];
  await page.evaluate((data) => {
    window.__thriftAssistantFixtures = data;
  }, records);
  await dialog
    .getByLabel('Screenshot files')
    .setInputFiles({ name: 'fixture-sale.png', mimeType: 'image/png', buffer: saleImage });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByText('Net profit: $26.00', { exact: true }).waitFor();
  const pending = JSON.parse(
    await page.evaluate(() =>
      sessionStorage.getItem(
        Object.keys(sessionStorage).find((k) => k.startsWith('thrift-log.draft.assistant.')),
      ),
    ),
  );
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await dialog.getByText(/Saved 1 approved record/).waitFor({ timeout: 20000 });
  saved = await workspace();
  saved.imports.forEach((i) => {
    const reference = JSON.parse(i.rawCsv).screenshot.reference;
    if (reference) paths.add(reference);
  });
  check(
    'Hosted sale keeps original cost and correct direct amounts',
    saved.orders.length === 1 &&
      saved.orders[0].lines[0].costBasis === 1200 &&
      saved.orders[0].fees === 400 &&
      saved.orders[0].shipping === 300,
  );
  check(
    'Hosted sale marks inventory sold and cross-listing for removal',
    saved.items.find((i) => i.id === itemId)?.status === 'Sold' &&
      saved.listings.find((l) => l.externalId === 'fixture-depop')?.status === 'Needs delisting',
  );
  const replay = await context.request.post(origin + '/api/assistant/approve', {
    headers: { Origin: origin },
    data: { batch: pending, rowIds: [pending.rows[0].id] },
  });
  check(
    'Lost-response retry is confirmed without another sale',
    replay.ok() &&
      (await replay.json()).replayed === true &&
      (await workspace()).orders.length === 1,
  );
  stage = 'duplicate screenshot and private source verification';
  await page.evaluate((data) => {
    window.__thriftAssistantFixtures = data;
  }, records);
  await dialog
    .getByLabel('Screenshot files')
    .setInputFiles({ name: 'fixture-sale.png', mimeType: 'image/png', buffer: saleImage });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }).waitFor();
  check(
    'Repeat screenshot is not approvable',
    await dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }).isDisabled(),
  );
  for (const path of paths) {
    const download = await admin.storage.from('inventory-photos').download(path);
    check(
      'Approved source remains private and readable for verification',
      !download.error && download.data.size > 0,
    );
  }
  const anonymous = createClient(config.url, config.publicKey, { auth: { persistSession: false } });
  const denied = await anonymous.storage.from('inventory-photos').download([...paths][0]);
  check('Anonymous source screenshot download denied', !!denied.error);
  stage = 'sign-out';
  const signedOut = await context.request.post(origin + '/api/auth', {
    headers: { Origin: origin },
    data: { action: 'signout' },
  });
  check('Disposable assistant session signs out', signedOut.ok());
} catch (error) {
  passed = false;
  console.error(
    `FAIL ${stage}: ${error instanceof CheckFailure ? error.message : (error.name + ': ' + error.message.split('\n')[0]).replaceAll(email, '[test account]').replaceAll(password, '[redacted]')}`,
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (userId) {
    // Re-discover only this disposable account's objects so failure mid-upload cannot orphan one.
    const listed = await admin.storage.from('inventory-photos').list(userId, { limit: 1000 });
    if (listed.error) {
      passed = false;
      console.error('FAIL Test screenshot cleanup listing');
    } else for (const o of listed.data) paths.add(`${userId}/${o.name}`);
    if (paths.size) {
      const removed = await admin.storage.from('inventory-photos').remove([...paths]);
      if (removed.error) {
        passed = false;
        console.error('FAIL Test screenshot cleanup');
      }
    }
    for (const table of [
      'order_lines',
      'financial_audit',
      'orders',
      'listings',
      'items',
      'imports',
      'workspaces',
    ]) {
      const removed = await admin.from(table).delete().eq('user_id', userId);
      if (removed.error) {
        passed = false;
        console.error(`FAIL Disposable ${table} cleanup`);
      }
    }
    const client = createClient(config.url, config.publicKey, { auth: { persistSession: false } });
    const login = await client.auth.signInWithPassword({ email, password });
    token = login.data.session?.access_token;
    if (token) await admin.auth.admin.signOut(token, 'global');
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) {
      passed = false;
      console.error('FAIL Disposable assistant account cleanup');
    } else console.log('PASS Disposable assistant records, screenshots and account cleaned up');
  }
  process.exitCode = passed ? 0 : 1;
}
