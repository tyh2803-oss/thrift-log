// Opt-in live vision verification. No approval or business/storage writes are allowed.
// Images and inventory are clearly labeled test fixtures. OpenAI extraction is NOT mocked.
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { readConfiguration } from '../src/lib/supabase/config.ts';
const config = readConfiguration(process.env);
if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is missing.');
if (new URL(config.url).hostname !== 'gvwgasebholdawlakwdf.supabase.co')
  throw new Error('Use the verified Thrift Log project.');
const origin = 'http://127.0.0.1:3153',
  output = 'test-results/live-vision';
const admin = createClient(config.url, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const auth = createClient(config.url, config.publicKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let server,
  browser,
  session,
  owner,
  stage = 'read-only baseline',
  passed = true,
  before;
let blockedWrites = 0;
const checks = [];
class CheckFailure extends Error {}
function check(name, condition) {
  checks.push({ name, passed: !!condition });
  if (!condition) throw new CheckFailure(name);
  console.log('PASS ' + name);
}
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function snapshot() {
  const w = await admin.rpc('load_workspace', { p_user_id: owner.id });
  const audit = await admin
    .from('financial_audit')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', owner.id);
  const photos = await admin.storage
    .from('inventory-photos')
    .list(owner.id, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (w.error || audit.error || photos.error) throw new Error('Read-only baseline unavailable');
  return {
    workspaceHash: hash(w.data),
    auditCount: audit.count,
    photosHash: hash(photos.data),
    workspace: w.data,
  };
}
const item = (id, sku, title, cost, brand, size, color) => ({
  id,
  sku,
  title,
  cost,
  brand,
  size,
  color,
  category: 'Clothing',
  condition: 'Good',
  description: '',
  asking: 5500,
  purchasedAt: '2026-10-01T12:00:00Z',
  source: 'Test fixture',
  storage: '',
  notes: 'In-memory fixture only',
  status: 'Listed',
  tripId: null,
  photos: [],
  createdAt: '2026-10-01T12:00:00Z',
});
const jacket = item(
  randomUUID(),
  'VISION-JACKET',
  'Blue Carhartt Workwear Jacket',
  1200,
  'Carhartt',
  'L',
  'Blue',
);
const hoodie = item(randomUUID(), 'VISION-HOODIE', 'Grey Nike Hoodie', 700, 'Nike', 'M', 'Grey');
const fixture = {
  revision: 0,
  imports: [],
  financialEvents: [],
  payouts: [],
  shipments: [],
  items: [jacket, hoodie],
  orders: [],
  expenses: [],
  locations: [],
  trips: [],
  shows: [],
  sessions: [],
  settings: {
    currency: 'USD',
    timezone: 'America/New_York',
    theme: 'light',
    monthlyGoal: 150000,
    widgets: ['chart', 'shows', 'sales', 'activity'],
  },
  listings: [
    {
      id: randomUUID(),
      itemId: jacket.id,
      marketplace: 'Vinted',
      price: 4500,
      originalPrice: 4500,
      externalId: 'VISION-LIST-1',
      url: '',
      listedAt: '2026-10-02T12:00:00Z',
      status: 'Active',
      format: 'Fixed price',
      lastSync: null,
    },
    {
      id: randomUUID(),
      itemId: hoodie.id,
      marketplace: 'Depop',
      price: 3200,
      originalPrice: 3200,
      externalId: 'VISION-LIST-2',
      url: '',
      listedAt: '2026-10-02T12:00:00Z',
      status: 'Active',
      format: 'Fixed price',
      lastSync: null,
    },
  ],
};
const html = (title, platform, order, sku, listing, price, rows, status = 'Sale completed') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f4f5f2;font:22px -apple-system,BlinkMacSystemFont,Arial;color:#23382d}.page{padding:38px;max-width:750px;margin:auto}.test{font-size:16px;color:#6f766e;border-bottom:1px solid #ccc;padding-bottom:18px}.platform{font-size:40px;font-weight:700;margin:24px 0}.status{color:#17654b;font-size:30px;font-weight:700}.card{background:white;padding:30px;border-radius:18px;margin:25px 0}h1{font-size:30px;margin:5px 0 24px}p{margin:14px 0}.line{display:flex;justify-content:space-between;border-bottom:1px solid #e8e8e8;padding:14px 0}.meta{font-size:19px;color:#4a5d50}.note{font-size:16px;margin-top:24px}</style></head><body><main class="page"><div class="test">THRIFT LOG INTEGRATION TEST — FICTIONAL EXAMPLE DATA</div><div class="platform">${platform}</div><div class="status">${status}</div><section class="card"><h1>${title}</h1><p class="meta">Order ID: ${order}</p><p class="meta">Seller SKU: ${sku}</p><p class="meta">Listing ID: ${listing}</p><p class="meta">Date: 2026-11-08</p><p class="meta">Currency: USD</p><div class="line"><b>Item sale price</b><b>$${price}</b></div>${rows.map(([k, v]) => `<div class="line"><span>${k}</span><span>${v}</span></div>`).join('')}<p class="note">This is a rendered example receipt for live image extraction testing. It is not an actual marketplace order.</p></section></main></body></html>`;
try {
  await mkdir(output, { recursive: true });
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  owner = users.data?.users?.find((u) => u.email?.toLowerCase() === config.ownerEmail);
  check(
    'Configured owner found without displaying identity or credentials',
    !users.error && !!owner,
  );
  before = await snapshot();
  check('Private business baseline read', true);
  stage = 'temporary read-only owner session';
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: config.ownerEmail });
  check(
    'One-time test link generated without sending email',
    !link.error && link.data.user?.id === owner.id,
  );
  const login = await auth.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: 'email',
  });
  session = login.data.session;
  check('Temporary owner session authenticated', !login.error && !!session);
  const jar = new Map();
  const serializer = createServerClient(config.url, config.publicKey, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: false, path: '/' },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const serialized = await serializer.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  check('Temporary cookies serialized in memory', !serialized.error);
  stage = 'fresh production app';
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3153'],
    { env: { ...process.env }, stdio: 'ignore' },
  );
  let ready = false;
  for (let n = 0; n < 80 && !ready; n++) {
    if (server.exitCode !== null) break;
    try {
      ready = (await fetch(origin + '/login')).ok;
    } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  check('Fresh server reads the new environment', ready);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    serviceWorkers: 'block',
  });
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    })),
  );
  const configured = await context.request.get(origin + '/api/assistant/extract');
  const settings = await configured.json();
  check('Authenticated assistant sees the API key', configured.ok() && settings.enabled === true);
  console.log('Application extraction model: ' + settings.model);
  // Fixture inventory exists only in this isolated browser's GET response, never in Supabase.
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (
      url.origin === origin &&
      req.method() === 'POST' &&
      ['/api/workspace', '/api/photos', '/api/assistant/approve'].includes(url.pathname)
    ) {
      blockedWrites++;
      await route.abort();
      return;
    }
    if (url.origin === origin && url.pathname === '/api/workspace' && req.method() === 'GET') {
      await route.fulfill({ json: fixture });
      return;
    }
    await route.continue();
  });
  const imagePage = await context.newPage();
  await imagePage.setViewportSize({ width: 900, height: 1500 });
  const knownRows = [
    ['Marketplace seller fees', '$4.00'],
    ['Payment processing fee', '$0.00'],
    ['Seller-paid shipping cost', '$3.00'],
    ['Shipping money received by seller', '$0.00'],
    ['Discount', '$0.00'],
    ['Refund', '$0.00'],
    ['Packaging and other direct costs', '$0.00'],
  ];
  await imagePage.setContent(
    html(
      'Blue Carhartt jacket — Large',
      'Vinted',
      'VISION-ORDER-1',
      'VISION-JACKET',
      'VISION-LIST-1',
      '45.00',
      knownRows,
    ),
  );
  await imagePage.screenshot({ path: output + '/completed-sale.png', fullPage: true });
  await imagePage.setContent(
    html(
      'Grey Nike Hoodie — Medium',
      'Depop',
      'VISION-ORDER-2',
      'VISION-HOODIE',
      'VISION-LIST-2',
      '32.00',
      [
        ['Seller fees', 'Not shown'],
        ['Seller shipping cost', 'Not shown'],
      ],
    ),
  );
  await imagePage.screenshot({ path: output + '/missing-costs.png', fullPage: true });
  await imagePage.setContent(
    html(
      'Blue Carhartt jacket — Large',
      'Vinted',
      'VISION-OFFER-1',
      'VISION-JACKET',
      'VISION-LIST-1',
      '40.00',
      [['Payment status', 'Awaiting buyer payment']],
      'Offer accepted — payment pending',
    ),
  );
  await imagePage.screenshot({ path: output + '/pending-offer.png', fullPage: true });
  await imagePage.close();
  stage = 'real image extraction and preview';
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Import files')
    .setInputFiles([
      output + '/completed-sale.png',
      output + '/missing-costs.png',
      output + '/pending-offer.png',
    ]);
  const responsePromise = page.waitForResponse(
    (r) => r.url() === origin + '/api/assistant/extract' && r.request().method() === 'POST',
    { timeout: 180000 },
  );
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await responsePromise;
  const data = await response.json();
  await writeFile(
    output + '/extraction.json',
    JSON.stringify({ httpStatus: response.status(), ...data }, null, 2),
  );
  if (!response.ok) {
    console.log('Extraction response: ' + String(data.error || 'Request failed'));
    throw new Error('Live image extraction must return HTTP 200');
  }
  check(
    'Real OpenAI vision request returned structured screenshot facts',
    data.screenshots?.length === 3,
  );
  const complete = data.screenshots.find((s) =>
    s.extraction.records.some((r) => r.externalOrderId === 'VISION-ORDER-1'),
  );
  const sale = complete?.extraction.records.find((r) => r.externalOrderId === 'VISION-ORDER-1');
  check(
    'Sale title, platform, completion and visible money extracted',
    sale?.kind === 'sale' &&
      sale.marketplace === 'Vinted' &&
      sale.status === 'completed' &&
      sale.currency === 'USD' &&
      sale.lines[0].price === 4500 &&
      sale.fees === 400 &&
      sale.processing === 0 &&
      sale.shipping === 300 &&
      sale.shippingCollected === 0 &&
      sale.discount === 0 &&
      sale.refund === 0 &&
      sale.other === 0,
  );
  const draftText = await page.evaluate(() =>
    sessionStorage.getItem(
      Object.keys(sessionStorage).find((k) => k.startsWith('thrift-log.draft.assistant.')),
    ),
  );
  const draft = JSON.parse(draftText);
  check(
    'Exact identifiers matched live extraction to in-memory inventory',
    draft.rows.find((r) => r.facts.externalOrderId === 'VISION-ORDER-1')?.matches[0].itemId ===
      jacket.id,
  );
  const card = dialog.locator('.assistant-extraction').filter({ hasText: 'VISION-JACKET' }).first();
  await card.getByText(/(?:Net|Provisional) profit: \$26\.00/).waitFor();
  check('Existing financial preview calculates $45 - $4 - $3 - $12 = $26', true);
  const missing = data.screenshots
    .flatMap((s) => s.extraction.records)
    .find((r) => r.externalOrderId === 'VISION-ORDER-2');
  check(
    'Missing fees and seller shipping remain unknown',
    missing?.fees === null && missing.shipping === null,
  );
  const offerImage = data.screenshots.find((s) => s.name === 'pending-offer.png');
  check(
    'Accepted offer is not a completed sale',
    !!offerImage && offerImage.extraction.records.every((r) => r.status !== 'completed'),
  );
  const readyCount = await dialog.getByRole('button', { name: /Approve All Ready/ }).textContent();
  check(
    'Only the fully known sale can be ready for approval',
    readyCount.trim() === 'Approve All Ready (1)',
  );
  await page.screenshot({ path: output + '/review.png', fullPage: true, animations: 'disabled' });
  check('No approval, photo upload or business write was attempted', blockedWrites === 0);
  await writeFile(
    output + '/preview.json',
    JSON.stringify({ fixtureInventory: true, liveOpenAI: true, draft, readyCount }, null, 2),
  );
  console.log('No Approve button was clicked. Test inventory was never persisted.');
} catch (error) {
  passed = false;
  console.error(
    'FAIL ' +
      stage +
      ': ' +
      (error instanceof CheckFailure || error.message?.startsWith('Live image')
        ? error.message
        : 'Verification did not complete. Review the sanitized test artifacts.'),
  );
} finally {
  if (before && owner) {
    try {
      const after = await snapshot();
      check(
        'Private workspace, financial audit and photo storage unchanged',
        after.workspaceHash === before.workspaceHash &&
          after.auditCount === before.auditCount &&
          after.photosHash === before.photosHash,
      );
    } catch {
      passed = false;
      console.error('FAIL No-write baseline comparison');
    }
  }
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (session) {
    const revoked = await admin.auth.admin.signOut(session.access_token, 'local');
    if (revoked.error) {
      passed = false;
      console.error('FAIL Temporary test-session cleanup');
    } else console.log('PASS Only the temporary test session was revoked');
  }
  await mkdir(output, { recursive: true });
  await writeFile(
    output + '/result.json',
    JSON.stringify(
      { passed, liveOpenAI: true, fixtureImages: true, fixtureInventory: true, checks },
      null,
      2,
    ),
  );
  process.exitCode = passed ? 0 : 1;
}
