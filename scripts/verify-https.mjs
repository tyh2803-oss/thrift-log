// Opt-in HTTPS + real Supabase + real OpenAI test. Only disposable business records are saved.
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { spawn } from 'node:child_process';
import https from 'node:https';
import sharp from 'sharp';
import { readConfiguration } from '../src/lib/supabase/config.ts';
import { httpsPaths, localHttpsConfig } from './local-https.mjs';
// Node's APIRequestContext needs the CA too; Chromium's leaf pin does not configure Node TLS.
// Re-execute only this test process with an additional trusted CA, preserving certificate validation.
if (process.env.NODE_EXTRA_CA_CERTS !== httpsPaths.ca) {
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: httpsPaths.ca },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  process.exit(typeof code === 'number' ? code : 1);
}
const config = readConfiguration(process.env);
if (new URL(config.url).hostname !== 'gvwgasebholdawlakwdf.supabase.co')
  throw new Error('Use the verified project.');
if (!process.env.OPENAI_API_KEY)
  throw new Error('OPENAI_API_KEY is required for live extraction verification.');
const { host } = await localHttpsConfig(),
  origin = `https://${host}:3156`;
const admin = createClient(config.url, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `thrift-https-${randomUUID()}@example.invalid`,
  password = randomBytes(36).toString('base64url');
const ca = await readFile(httpsPaths.ca),
  leaf = new X509Certificate(await readFile(httpsPaths.cert));
const pin = createHash('sha256')
  .update(leaf.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
let userId,
  server,
  browser,
  context,
  page,
  stage = 'setup',
  passed = true;
class CheckFailure extends Error {}
function check(name, ok) {
  if (!ok) throw new CheckFailure(name);
  console.log('PASS ' + name);
}
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function workspace() {
  const r = await context.request.get(origin + '/api/workspace');
  check('Authenticated workspace reload', r.ok());
  return r.json();
}
async function strictTls() {
  return new Promise((resolve, reject) =>
    https
      .get(origin + '/login', { ca, rejectUnauthorized: true }, (r) => {
        const ok = r.statusCode === 200 && r.socket.authorized;
        r.resume();
        r.on('end', () => resolve(ok));
      })
      .on('error', reject),
  );
}
try {
  const account = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  check('Disposable HTTPS account created', !account.error && !!account.data.user);
  userId = account.data.user.id;
  server = spawn(process.execPath, ['scripts/https-test-server.mjs'], {
    env: { ...process.env, OWNER_EMAIL: email, NODE_ENV: 'production' },
    stdio: 'ignore',
  });
  stage = 'trusted TLS readiness';
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try {
      ready = await strictTls();
    } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  check('TLS validates against the local CA and IP SAN without ignoring errors', ready);
  stage = 'HTTPS browser';
  // Scoped trust of this generated leaf key in an isolated profile; no global certificate bypass or OS trust changes.
  browser = await chromium.launch({
    executablePath: process.env.HOSTED_CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
    args: [`--ignore-certificate-errors-spki-list=${pin}`],
  });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await page.goto(origin + '/login');
  const capabilities = await page.evaluate(async () => ({
    secure: isSecureContext,
    uuid: crypto.randomUUID(),
    hash: [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'))),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  }));
  check(
    'Secure context, native UUID and native SHA-256 work over the LAN',
    capabilities.secure &&
      /^[a-f0-9-]{36}$/.test(capabilities.uuid) &&
      capabilities.hash === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  stage = 'HTTPS sign-in';
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await page.waitForURL(origin + '/', { timeout: 20000 });
  const cookies = (await context.cookies()).filter((c) => c.name.includes('-auth-token'));
  check(
    'HTTPS Auth retains Secure HttpOnly SameSite=Lax host cookies',
    cookies.length > 0 &&
      cookies.every(
        (c) =>
          c.secure && c.httpOnly && c.sameSite === 'Lax' && c.domain === host && c.path === '/',
      ),
  );
  stage = 'inventory creation';
  await page.goto(origin + '/inventory');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const dialog = page.getByRole('dialog'),
    sku = `HTTPS-TEST-${randomUUID().slice(0, 6).toUpperCase()}`,
    title = 'HTTPS Fixture Carhartt Jacket';
  stage = 'inventory fields';
  await dialog.getByLabel('Item title').fill(title);
  await dialog.getByRole('textbox', { name: /^SKU/ }).fill(sku);
  await dialog.getByRole('spinbutton', { name: /^Purchase cost/ }).fill('12');
  await dialog.getByLabel('Asking price ($)').fill('45');
  await dialog
    .getByLabel(/^Purchased/)
    .fill(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10) + 'T12:00');
  stage = 'inventory save';
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  let saved = await workspace();
  const item = saved.items.find((i) => i.sku === sku);
  check(
    'Inventory created by the UI has a UUID and real stored $12 cost',
    !!item && item.cost === 1200 && /^[a-f0-9-]{36}$/.test(item.id),
  );
  await page.reload();
  check(
    'Inventory persists in Supabase after reload',
    (await workspace()).items.some((i) => i.id === item.id && i.cost === 1200),
  );
  await page.getByRole('button', { name: 'Add item', exact: true }).waitFor();
  stage = 'timer creation';
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await page.getByRole('button', { name: 'Buying', exact: true }).click();
  await page.getByRole('button', { name: 'Pause timer' }).waitFor();
  saved = await workspace();
  const timer = saved.sessions.find((s) => s.state === 'Running');
  check(
    'Timer created by the UI persists with a UUID',
    !!timer && /^[a-f0-9-]{36}$/.test(timer.id),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Pause timer' }).waitFor();
  check(
    'Running timer survives reload',
    (await workspace()).sessions.find((s) => s.id === timer.id)?.state === 'Running',
  );
  await page.getByRole('button', { name: 'End timer' }).click();
  await page.getByRole('button', { name: 'Start timer', exact: true }).waitFor();
  stage = 'real screenshot request';
  const receiptDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const lines = [
    'THRIFT LOG TEST - FICTIONAL EXAMPLE DATA',
    'VINTED - Sale completed - payment received',
    title,
    `Seller SKU: ${sku}`,
    `Order ID: HTTPS-SALE-${sku}`,
    `Sale date: ${receiptDate} | Currency: USD`,
    'Item sale price: $45.00',
    'Marketplace seller fees: $4.00',
    'Payment processing fee: $0.00',
    'Seller-paid shipping: $3.00',
    'Shipping paid by buyer: $0.00',
    'Discount: $0.00',
    'Refund: $0.00',
    'Other direct expenses: $0.00',
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1100"><rect width="100%" height="100%" fill="white"/>${lines.map((t, i) => `<text x="38" y="${60 + i * 70}" font-family="Arial" font-size="31" fill="black">${t}</text>`).join('')}</svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer(),
    other = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } })
      .png()
      .toBuffer();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const assistant = page.getByRole('dialog');
  await assistant.getByLabel('Screenshot files').setInputFiles([
    { name: 'https-sale.png', mimeType: 'image/png', buffer: image },
    { name: 'remove-me.png', mimeType: 'image/png', buffer: other },
  ]);
  await assistant.getByRole('button', { name: 'Remove remove-me.png', exact: true }).waitFor();
  check(
    'Multiple images attach with thumbnails after native hashing',
    await assistant.getByRole('button', { name: 'Remove https-sale.png', exact: true }).isVisible(),
  );
  await assistant.getByRole('button', { name: 'Remove remove-me.png', exact: true }).click();
  const before = await workspace();
  let attemptedWrites = 0;
  await page.route('**/api/assistant/approve', (r) => {
    attemptedWrites++;
    return r.fulfill({
      status: 409,
      contentType: 'application/json',
      body: '{"error":"No approvals in verification"}',
    });
  });
  await page.route('**/api/workspace', (r) =>
    r.request().method() === 'POST'
      ? (attemptedWrites++,
        r.fulfill({
          status: 409,
          contentType: 'application/json',
          body: '{"error":"No writes during review"}',
        }))
      : r.continue(),
  );
  await assistant.getByLabel('Message assistant').fill('Log this completed sale.');
  const extractionResponse = page.waitForResponse(
    (r) => r.url() === origin + '/api/assistant/extract' && r.request().method() === 'POST',
    { timeout: 90000 },
  );
  await assistant.getByRole('button', { name: 'Send', exact: true }).click();
  const extraction = await extractionResponse;
  check('Real server-side OpenAI screenshot request succeeds over HTTPS', extraction.ok());
  const extracted = await extraction.json();
  // This is a plain-text fixture receipt, not authentic marketplace UI. Review any
  // uncertain platform and warnings explicitly; never weaken production classification.
  const record = extracted.screenshots[0].extraction.records[0];
  if (
    !record.marketplace ||
    (await assistant
      .getByText('I reviewed these extraction warnings and corrected the details.', { exact: true })
      .count())
  ) {
    await assistant.getByRole('button', { name: 'Edit', exact: true }).click();
    if (!record.marketplace)
      await assistant
        .getByRole('combobox', { name: 'Marketplace', exact: true })
        .selectOption('Vinted');
    if (
      await assistant
        .getByText('I reviewed these extraction warnings and corrected the details.', {
          exact: true,
        })
        .count()
    )
      await assistant
        .getByText('I reviewed these extraction warnings and corrected the details.', {
          exact: true,
        })
        .click();
  }
  await assistant.getByText('Net profit: $26.00', { exact: true }).waitFor({ timeout: 20000 });
  check(
    'Live extraction matches the stored item and existing profit logic',
    await assistant.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).isEnabled(),
  );
  const after = await workspace();
  check(
    'AI prepare and review do not modify business records',
    attemptedWrites === 0 && hash(before) === hash(after) && after.orders.length === 0,
  );
  const photos = await admin.storage.from('inventory-photos').list(userId);
  check('No screenshot is uploaded before approval', !photos.error && photos.data.length === 0);
  check('No browser crashes in inventory, timer or screenshot workflows', errors.length === 0);
  await mkdir('test-results/https', { recursive: true });
  await writeFile('test-results/https/extraction.json', JSON.stringify(extracted, null, 2));
  await writeFile('test-results/https/receipt.png', image);
  stage = 'sign-out';
  const signedOut = await context.request.post(origin + '/api/auth', {
    headers: { Origin: origin },
    data: { action: 'signout' },
  });
  check('HTTPS session signs out', signedOut.ok());
} catch (error) {
  passed = false;
  console.error(`FAIL ${stage}: ${error instanceof CheckFailure ? error.message : error.name}`);
  if (page && !page.isClosed() && stage.startsWith('inventory')) {
    const diagnostic = JSON.stringify({
      path: new URL(page.url()).pathname,
      alerts: await page.getByRole('alert').allTextContents(),
      buttons: await page.getByRole('dialog').getByRole('button').allTextContents(),
      invalid: await page
        .getByRole('dialog')
        .locator('input')
        .evaluateAll((nodes) =>
          nodes
            .filter((n) => !n.validity.valid)
            .map((n) => ({ name: n.name, message: n.validationMessage })),
        ),
    });
    let safe = diagnostic.replaceAll(password, '[redacted]').replaceAll(email, '[test account]');
    for (const [name, value] of Object.entries(process.env))
      if (/KEY|TOKEN|SECRET|PASSWORD/.test(name) && value && value.length > 4)
        safe = safe.replaceAll(value, '[redacted]');
    console.error(safe);
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((r) => server.once('exit', r));
  }
  if (userId) {
    for (const table of [
      'order_lines',
      'financial_audit',
      'orders',
      'listings',
      'items',
      'imports',
      'sessions',
      'workspaces',
    ]) {
      const r = await admin.from(table).delete().eq('user_id', userId);
      if (r.error) {
        passed = false;
        console.error('FAIL Disposable cleanup: ' + table);
      }
    }
    const client = createClient(config.url, config.publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      login = await client.auth.signInWithPassword({ email, password });
    if (login.data.session)
      await admin.auth.admin.signOut(login.data.session.access_token, 'global');
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) {
      passed = false;
      console.error('FAIL Disposable account cleanup');
    } else console.log('PASS Disposable inventory, timer, account and sessions cleaned up');
  }
  process.exitCode = passed ? 0 : 1;
}
