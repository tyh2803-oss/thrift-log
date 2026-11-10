// Opt-in real Auth verification using only a disposable account. No business writes or credentials in logs.
import { createClient } from '@supabase/supabase-js';
import { chromium, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfiguration } from '../src/lib/supabase/config.ts';
const config = readConfiguration(process.env);
if (new URL(config.url).hostname !== 'gvwgasebholdawlakwdf.supabase.co')
  throw new Error('Use the verified project.');
const admin = createClient(config.url, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `thrift-signin-${randomUUID()}@example.invalid`,
  password = randomBytes(36).toString('base64url');
const origin = 'http://127.0.0.1:3155';
let userId,
  server,
  browser,
  stage = 'setup',
  passed = true;
function check(name, ok) {
  if (!ok) throw new Error(name);
  console.log(`PASS ${name}`);
}
async function submit(page) {
  const button = page.getByRole('button', { name: 'Sign in securely', exact: true });
  await button.waitFor({ state: 'visible' });
  // Ordinary pointer input, with DOM bounds. WebKit's locator hit testing fails on this host.
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error('Submit button not visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}
async function fill(page) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}
async function signout(context) {
  const response = await context.request.post(origin + '/api/auth', {
    headers: { Origin: origin },
    data: { action: 'signout' },
  });
  check('Disposable session signs out', response.ok());
}
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  check('Disposable sign-in account created', !created.error && !!created.data.user);
  userId = created.data.user.id;
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3155'],
    { env: { ...process.env, OWNER_EMAIL: email, OPENAI_API_KEY: '' }, stdio: 'ignore' },
  );
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try {
      ready = (await fetch(origin + '/login')).ok;
    } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  check('Isolated sign-in app ready', ready);
  for (const name of ['webkit', 'chromium']) {
    stage = name + ' browser startup';
    browser = await (name === 'webkit' ? webkit : chromium).launch({
      headless: true,
      ...(name === 'chromium' && process.env.HOSTED_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.HOSTED_CHROMIUM_EXECUTABLE }
        : {}),
    });
    for (const javaScriptEnabled of [true, false]) {
      stage = `${name} ${javaScriptEnabled ? 'enhanced' : 'native'} sign-in`;
      const context = await browser.newContext({
        javaScriptEnabled,
        serviceWorkers: 'block',
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await page.goto(origin + '/login');
      await fill(page);
      const authResponse = page.waitForResponse(
        (r) => r.url() === origin + '/api/auth' && r.request().method() === 'POST',
      );
      await submit(page);
      check(
        `${stage} POST accepted`,
        (await authResponse).status() === (javaScriptEnabled ? 200 : 303),
      );
      await page.waitForURL(origin + '/', { timeout: 20000 });
      check(
        `${stage} reaches authenticated home`,
        (await context.request.get(origin + '/api/workspace')).status() === 200,
      );
      const cookies = (await context.cookies()).filter((c) => c.name.includes('-auth-token'));
      check(
        `${stage} retains HttpOnly SameSite=Lax local cookies`,
        cookies.length > 0 && cookies.every((c) => c.httpOnly && c.sameSite === 'Lax' && !c.secure),
      );
      await page.reload();
      check(
        `${stage} survives reload`,
        (await context.request.get(origin + '/api/workspace')).status() === 200,
      );
      check(
        `${stage} URL never contains credentials`,
        !page.url().includes(email) && !page.url().includes(password),
      );
      await signout(context);
      await context.close();
    }
    stage = name + ' missing-cookie feedback';
    const context = await browser.newContext({ serviceWorkers: 'block' }),
      page = await context.newPage();
    await page.goto(origin + '/login');
    await page.route('**/api/auth', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
    );
    await fill(page);
    await submit(page);
    await page
      .getByRole('alert')
      .filter({ hasText: 'Your browser could not keep your sign-in session' })
      .waitFor();
    check(`${name} shows blocked-cookie error`, true);
    stage = name + ' timeout feedback';
    await page.unroute('**/api/auth');
    await page.clock.install();
    let started;
    const sent = new Promise((r) => {
      started = r;
    });
    await page.route('**/api/auth', () => {
      started();
    });
    await submit(page);
    await sent;
    await page.clock.fastForward(20001);
    await page.getByRole('alert').filter({ hasText: 'Sign-in timed out' }).waitFor();
    check(
      `${name} timeout restores usable submit button`,
      await page.getByRole('button', { name: 'Sign in securely', exact: true }).isEnabled(),
    );
    await context.close();
    await browser.close();
    browser = null;
  }
} catch (error) {
  passed = false;
  console.error(`FAIL ${stage}: ${error.name}`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((r) => server.once('exit', r));
  }
  if (userId) {
    const client = createClient(config.url, config.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.data.session)
      await admin.auth.admin.signOut(login.data.session.access_token, 'global');
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) {
      passed = false;
      console.error('FAIL Disposable sign-in account cleanup');
    } else console.log('PASS Disposable sign-in account and sessions cleaned up');
  }
  process.exitCode = passed ? 0 : 1;
}
