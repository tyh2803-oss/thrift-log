// Real isolated Auth/Storage/financial persistence with deterministic extraction fixtures.
// Never sends business images to OpenAI or touches the configured owner's records.
import { createClient } from '@supabase/supabase-js';
import { chromium, webkit } from '@playwright/test';
const browserName = process.env.HOSTED_BROWSER || 'webkit';
if (!['webkit', 'chromium'].includes(browserName)) throw new Error('Use webkit or chromium.');
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { readConfiguration } from '../src/lib/supabase/config.ts';
const config = readConfiguration(process.env);
if (
  process.env.HOSTED_LEDGER_POSTINGS === '1' &&
  process.env.HOSTED_LEDGER_ADMIN_CLEANUP_READY !== '1'
)
  throw new Error(
    'Immutable ledger fixture posting requires verified database-admin cleanup. Use normal hosted checks or local PGlite tests.',
  );
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
  stage = `${browserName} launch`;
  browser = await (browserName === 'webkit' ? webkit : chromium).launch({
    headless: true,
    ...(browserName === 'chromium' && process.env.HOSTED_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.HOSTED_CHROMIUM_EXECUTABLE }
      : {}),
  });
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
  check(`${browserName} private workspace sign-in`, true);
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
    .getByLabel('Import files')
    .setInputFiles({ name: 'fixture-listings.png', mimeType: 'image/png', buffer: listingImage });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const second = dialog.locator('.assistant-extraction').nth(1);
  await second.getByLabel('Purchase Cost ($)', { exact: true }).fill('15');
  await second.getByLabel('Listing Price ($)', { exact: true }).fill('62.50');
  await second.getByRole('combobox', { name: 'Marketplace', exact: true }).selectOption('Whatnot');
  await second.getByText('Edit additional details', { exact: true }).click();
  await second.getByLabel('Import notes', { exact: true }).fill('Inline import fixture notes.');
  await second.getByText('Edit additional details', { exact: true }).click();
  await second.getByRole('button', { name: 'Edit', exact: true }).click();
  await second.getByRole('button', { name: 'Create new physical item' }).click();
  await second.getByLabel('Purchase Cost ($)', { exact: true }).fill('15');
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
      saved.listings.find((l) => l.externalId === 'fixture-boots')?.marketplace === 'Whatnot' &&
      saved.listings.find((l) => l.externalId === 'fixture-boots')?.price === 6250 &&
      saved.items.find((i) => i.title === 'Fixture red boots')?.notes ===
        'Inline import fixture notes.' &&
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
    .getByLabel('Import files')
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
  stage = 'one-tap saved sale fulfillment';
  await dialog.getByRole('button', { name: 'Mark Shipped', exact: true }).click();
  await dialog.getByText(/Fulfillment saved/).waitFor({ timeout: 20000 });
  saved = await workspace();
  check(
    'One-tap Mark Shipped updates the saved order without another sale or expense',
    saved.orders.length === 1 &&
      saved.orders[0].fulfillment === 'Shipped' &&
      saved.orders[0].shipping === 300 &&
      saved.orders[0].fees === 400 &&
      saved.items.length === 2,
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
  stage = 'inline existing-item cost correction';
  const bootsBefore = saved.items.find((i) => i.title === 'Fixture red boots');
  await page.evaluate(
    (data) => {
      window.__thriftAssistantFixtures = data;
    },
    [
      record({
        kind: 'listing',
        status: 'active',
        marketplace: 'Whatnot',
        externalOrderId: null,
        lines: [line({ title: 'Fixture red boots', listingId: 'fixture-boots', price: 6250 })],
      }),
    ],
  );
  await dialog.getByLabel('Import files').setInputFiles({
    name: 'fixture-correction.png',
    mimeType: 'image/png',
    buffer: await png('#00ff00'),
  });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByLabel('Purchase Cost ($)', { exact: true }).waitFor();
  check(
    'Matched inventory cost starts read-only at its stored value',
    (await dialog.getByLabel('Purchase Cost ($)', { exact: true }).inputValue()) === '15' &&
      (await dialog.getByLabel('Purchase Cost ($)', { exact: true }).getAttribute('readonly')) !==
        null,
  );
  await dialog.getByRole('button', { name: 'Correct cost', exact: true }).click();
  await dialog.getByLabel('Purchase Cost ($)', { exact: true }).fill('16');
  check(
    'Proposed cost correction has not modified Supabase',
    (await workspace()).items.find((i) => i.id === bootsBefore.id)?.cost === 1500,
  );
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await dialog.locator('.assistant-extraction').waitFor({ state: 'hidden', timeout: 20000 });
  saved = await workspace();
  const bootsAfter = saved.items.find((i) => i.id === bootsBefore.id);
  check(
    'Approved correction changes only acquisition cost with no duplicate item/listing',
    saved.items.length === 2 &&
      saved.listings.length === 3 &&
      JSON.stringify(bootsAfter) === JSON.stringify({ ...bootsBefore, cost: 1600 }),
  );
  check(
    'Previously posted sale cost snapshot remains unchanged',
    saved.orders[0].lines[0].costBasis === 1200,
  );
  saved.imports.forEach((i) => {
    const reference = JSON.parse(i.rawCsv).screenshot.reference;
    if (reference) paths.add(reference);
  });
  stage = 'screenshot-delivered lifecycle approval';
  await page.evaluate(
    (data) => {
      window.__thriftAssistantFixtures = data;
    },
    [
      record({
        kind: 'fulfillment',
        status: 'delivered',
        date: new Date().toISOString(),
        event: {
          type: 'delivered',
          confidence: 'clear',
          evidence: ['Deterministic delivery confirmation'],
          scope: 'order',
          carrier: 'Fixture carrier',
          tracking: 'TRACK-DELIVERED',
          labelCost: null,
          externalEventId: null,
        },
      }),
    ],
  );
  await dialog.getByLabel('Import files').setInputFiles({
    name: 'fixture-delivered.png',
    mimeType: 'image/png',
    buffer: await png('#ffaa00'),
  });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).waitFor();
  check(
    'Delivery event review has not changed fulfillment before approval',
    (await workspace()).orders[0].fulfillment === 'Shipped',
  );
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await dialog.locator('.assistant-extraction').waitFor({ state: 'hidden', timeout: 20000 });
  saved = await workspace();
  check(
    'Delivery screenshot updates fulfillment without duplicate sale/item/expense',
    saved.orders.length === 1 &&
      saved.items.length === 2 &&
      saved.orders[0].fulfillment === 'Delivered' &&
      saved.orders[0].shipping === 300 &&
      saved.financialEvents.length === 0,
  );
  saved.imports.forEach((i) => {
    const source = JSON.parse(i.rawCsv).screenshot?.reference;
    if (source) paths.add(source);
  });
  // Immutable posting tests require separate admin cleanup; normal hosted checks avoid retaining ledger fixtures.
  if (process.env.HOSTED_LEDGER_POSTINGS === '1') {
    stage = 'verified refund and physical return approval';
    await page.evaluate(
      (data) => {
        window.__thriftAssistantFixtures = data;
      },
      [
        record({
          kind: 'return',
          status: 'returned',
          date: new Date().toISOString(),
          refund: 500,
          event: {
            type: 'returned',
            confidence: 'clear',
            evidence: ['Deterministic seller receipt and completed refund'],
            scope: 'order',
            carrier: null,
            tracking: null,
            labelCost: null,
            externalEventId: 'fixture-rma-1',
          },
        }),
      ],
    );
    await dialog.getByLabel('Import files').setInputFiles({
      name: 'fixture-return.png',
      mimeType: 'image/png',
      buffer: await png('#abc001'),
    });
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await dialog.getByRole('checkbox', { name: /I received these physical items back/ }).check();
    await dialog.getByRole('checkbox', { name: /Also record the verified refund/ }).check();
    check(
      'Financial return remains unsaved before approval',
      (await workspace()).financialEvents.length === 0,
    );
    await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
    await dialog.locator('.assistant-extraction').waitFor({ state: 'hidden', timeout: 20000 });
    saved = await workspace();
    check(
      'Refund and physical return commit together through the dated ledger',
      saved.orders.length === 1 &&
        saved.financialEvents.length === 2 &&
        saved.financialEvents.some((e) => e.kind === 'Refund' && e.amount === 500) &&
        saved.financialEvents.some((e) => e.kind === 'Return' && e.itemIds.includes(itemId)) &&
        saved.items.find((i) => i.id === itemId)?.status === 'Returned' &&
        saved.orders[0].lines[0].costBasis === 1200,
    );
    saved.imports.forEach((i) => {
      const source = JSON.parse(i.rawCsv).screenshot?.reference;
      if (source) paths.add(source);
    });
    stage = 'unfulfilled cancellation fixture sale';
    await page.evaluate(
      (data) => {
        window.__thriftAssistantFixtures = data;
      },
      [
        record({
          marketplace: 'Whatnot',
          externalOrderId: 'fixture-cancel-order',
          fees: 0,
          shipping: 0,
          lines: [line({ title: 'Fixture red boots', listingId: 'fixture-boots', price: 6250 })],
        }),
      ],
    );
    await dialog.getByLabel('Import files').setInputFiles({
      name: 'fixture-cancel-sale.png',
      mimeType: 'image/png',
      buffer: await png('#abc002'),
    });
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
    await dialog.locator('.assistant-extraction').waitFor({ state: 'hidden', timeout: 20000 });
    stage = 'cancellation lifecycle approval';
    await page.evaluate(
      (data) => {
        window.__thriftAssistantFixtures = data;
      },
      [
        record({
          kind: 'cancellation',
          status: 'cancelled',
          marketplace: 'Whatnot',
          externalOrderId: 'fixture-cancel-order',
          date: new Date().toISOString(),
          event: {
            type: 'cancelled',
            confidence: 'clear',
            evidence: ['Deterministic cancellation before shipment'],
            scope: 'order',
            carrier: null,
            tracking: null,
            labelCost: null,
            externalEventId: null,
          },
        }),
      ],
    );
    await dialog.getByLabel('Import files').setInputFiles({
      name: 'fixture-cancel.png',
      mimeType: 'image/png',
      buffer: await png('#abc003'),
    });
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
    await dialog.locator('.assistant-extraction').waitFor({ state: 'hidden', timeout: 20000 });
    saved = await workspace();
    check(
      'Cancellation restores available inventory without another physical item or order',
      saved.orders.length === 2 &&
        saved.items.length === 2 &&
        saved.orders.find((o) => o.externalId === 'fixture-cancel-order')?.status === 'Cancelled' &&
        saved.items.find((i) => i.id === bootsBefore.id)?.status === 'Ready to List' &&
        saved.financialEvents.length === 2,
    );
    saved.imports.forEach((i) => {
      const source = JSON.parse(i.rawCsv).screenshot?.reference;
      if (source) paths.add(source);
    });
  }
  stage = 'duplicate screenshot and private source verification';
  await page.evaluate((data) => {
    window.__thriftAssistantFixtures = data;
  }, records);
  await dialog
    .getByLabel('Import files')
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
    const protectedRows = await admin
      .from('financial_events')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (protectedRows.error || protectedRows.data.length) {
      passed = false;
      console.error(
        'FAIL Immutable fixture postings need database-admin cleanup. No ledger protections were changed.',
      );
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
