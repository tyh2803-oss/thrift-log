// Real browser/password verification with an isolated app and disposable account.
// No tracing, screenshots, credentials, session values, or private records are printed.
import { createClient } from '@supabase/supabase-js';
import { webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfiguration } from '../src/lib/supabase/config.ts';

const config = readConfiguration(process.env);
if (new URL(config.url).hostname !== 'gvwgasebholdawlakwdf.supabase.co')
  throw new Error('Use the verified Thrift Log project.');
const admin = createClient(config.url, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `thrift-log-browser-${randomUUID()}@example.invalid`;
const password = randomBytes(36).toString('base64url');
const origin = 'http://127.0.0.1:3151';
let userId, browser, server, token;
let passed = true;
let stage = 'disposable account setup';
class CheckFailure extends Error {}
function check(name, condition) {
  if (!condition) throw new CheckFailure(name);
  console.log(`PASS ${name}`);
}
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  check('Disposable browser-test account created', !created.error && !!created.data.user);
  userId = created.data.user.id;
  stage = 'isolated app startup';
  // Override only the disposable process's owner. The real .env.local is untouched.
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3151'],
    { env: { ...process.env, OWNER_EMAIL: email }, stdio: 'ignore' },
  );
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt++) {
    if (server.exitCode !== null) break;
    try {
      ready = (await fetch(origin + '/login')).ok;
    } catch {
      /* Starting. */
    }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('Isolated production app is ready', ready);
  stage = 'WebKit password sign-in';
  browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(origin + '/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const response = page.waitForResponse(
    (r) => r.url() === origin + '/api/auth' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  check('Password form submits successfully to real Auth', (await response).status() === 200);
  const cookies = (await context.cookies()).filter((c) => c.name.includes('-auth-token'));
  check(
    'WebKit retains HttpOnly SameSite=Lax cookies on local HTTP',
    cookies.length > 0 && cookies.every((c) => c.httpOnly && c.sameSite === 'Lax' && !c.secure),
  );
  await page.waitForURL(origin + '/', { timeout: 15000 });
  check('Successful sign-in navigates out of the login page', new URL(page.url()).pathname === '/');
  check(
    'Browser can read its authenticated workspace',
    (await context.request.get(origin + '/api/workspace')).status() === 200,
  );
  await page.reload();
  check(
    'Authenticated browser session survives reload',
    (await context.request.get(origin + '/api/workspace')).status() === 200,
  );
  // Retain a token solely to revoke this disposable session if a later check fails.
  const client = createClient(config.url, config.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  token = login.data.session?.access_token;
  check(
    'App sign-out clears the browser session',
    (
      await context.request.post(origin + '/api/auth', {
        headers: { Origin: origin },
        data: { action: 'signout' },
      })
    ).status() === 200,
  );
  token = undefined; // App sign-out revokes all sessions of this disposable user.
  check(
    'Browser workspace access is denied after sign-out',
    (await context.request.get(origin + '/api/workspace')).status() === 401,
  );
  stage = 'missing-cookie page';
  // Simulate a browser refusing session cookies while Auth itself succeeds.
  await page.goto(origin + '/login');
  await page.route('**/api/auth', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
  stage = 'missing-cookie form';
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  stage = 'missing-cookie submit';
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  stage = 'missing-cookie error display';
  await page
    .getByRole('alert')
    .filter({ hasText: 'Your browser could not keep your sign-in session' })
    .waitFor({ timeout: 10000 });
  check('Missing-cookie sign-in shows a visible error instead of looping', true);
} catch (error) {
  passed = false;
  console.error(
    `FAIL ${stage}: ${error instanceof CheckFailure ? error.message : 'Browser check could not complete'}`,
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (token) await admin.auth.admin.signOut(token, 'global');
  if (userId) {
    // Covers a failure before the app sign-out, without exposing generated credentials.
    const cleanupClient = createClient(config.url, config.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await cleanupClient.auth.signInWithPassword({ email, password });
    if (login.data.session)
      await admin.auth.admin.signOut(login.data.session.access_token, 'global');
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) {
      passed = false;
      console.error('FAIL Disposable browser account cleanup');
    } else console.log('PASS Disposable browser account and sessions cleaned up');
  }
  process.exitCode = passed ? 0 : 1;
}
