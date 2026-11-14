import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';
const actor = '11111111-1111-4111-8111-111111111111';
const friend = '22222222-2222-4222-8222-222222222222';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
async function openProfile(page: Page) {
  await page.getByRole('button', { name: 'Open profile menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /^(Add|Change) profile photo$/ }).click();
  return page.getByRole('dialog', { name: 'Your profile', exact: true });
}
async function upload(page: Page) {
  const dialog = await openProfile(page);
  await dialog.getByLabel('Choose profile photo', { exact: true }).setInputFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width: 80, height: 100, channels: 3, background: '#44775a' } })
      .png()
      .toBuffer(),
  });
  await expect(dialog.getByRole('status')).toHaveText('Profile photo saved.');
  const path = new URL(
    (await dialog.locator('img').getAttribute('src'))!,
    'http://test',
  ).searchParams.get('path')!;
  await expect
    .poll(() => dialog.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  return path;
}
test.beforeEach(async ({ request, page }) => {
  await request.post(authOrigin + '/__reset');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
test('private photo survives reload and another device, supports replacement/removal, and leaves business records and password untouched', async ({
  page,
  request,
  browser,
}) => {
  const before = await (await request.get(authOrigin + '/__metrics')).json();
  const path = await upload(page);
  expect(path).toMatch(new RegExp('^' + actor + '/profile-'));
  await expect(page.getByRole('button', { name: 'Open profile menu' })).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Open profile menu' }).locator('img'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Object.values(localStorage).some((v) => v.includes('data:image/'))),
  ).toBe(false);
  const state = await page.context().storageState();
  const device = await browser.newContext({
    storageState: { cookies: state.cookies, origins: [] },
    serviceWorkers: 'block',
  });
  const devicePage = await device.newPage();
  await devicePage.goto('/');
  await expect(
    devicePage.getByRole('button', { name: 'Open profile menu' }).locator('img'),
  ).toHaveAttribute('src', `/api/photos?path=${encodeURIComponent(path)}`);
  const second = await upload(page);
  expect(second).not.toBe(path);
  await expect
    .poll(async () =>
      (await page.request.get('/api/photos?path=' + encodeURIComponent(path))).status(),
    )
    .toBe(404);
  const dialog = await openProfile(page);
  await dialog.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Profile photo removed.');
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open profile menu' }).locator('img')).toHaveCount(
    0,
  );
  const after = await (await request.get(authOrigin + '/__metrics')).json();
  expect(after.workspaces).toEqual(before.workspaces);
  expect(after.businessWrites).toBe(0);
  expect(after.profileUpdates).toEqual([actor, actor, actor]);
  expect(after.passwordUpdates).toEqual([]);
  expect(after.profileRemovals).toBe(2);
  await page.getByRole('button', { name: 'Open profile menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await device.close();
});
async function activateFriend(context: BrowserContext, page: Page, other: BrowserContext) {
  const origin = new URL(page.url()).origin;
  const setup = await context.request.post('/api/beta', {
    headers: { origin, 'x-thrift-user': actor },
    data: { action: 'setup', email: 'friend@example.test' },
  });
  const link = (await setup.json()).setup.link;
  const hash = new URLSearchParams(new URL(link).hash.slice(1)).get('token_hash');
  expect(
    (
      await other.request.post('/api/tester-setup', {
        headers: { origin },
        data: { token_hash: hash },
      })
    ).ok(),
  ).toBe(true);
}
test('two accounts have isolated photos and revoked testers cannot upload or read photos', async ({
  page,
  browser,
  request,
}) => {
  const ownerPath = await upload(page);
  const other = await browser.newContext({ serviceWorkers: 'block' });
  await activateFriend(page.context(), page, other);
  const friendPage = await other.newPage();
  await friendPage.goto('/');
  await expect(
    friendPage.getByRole('button', { name: 'Open profile menu' }).locator('img'),
  ).toHaveCount(0);
  const friendPath = await upload(friendPage);
  expect(friendPath).toMatch(new RegExp('^' + friend + '/profile-'));
  expect(
    (await other.request.get('/api/photos?path=' + encodeURIComponent(ownerPath))).status(),
  ).toBe(404);
  expect(
    (await page.request.get('/api/photos?path=' + encodeURIComponent(friendPath))).status(),
  ).toBe(404);
  expect(
    (await page.request.get('/api/photos?path=' + encodeURIComponent(ownerPath))).status(),
  ).toBe(200);
  const origin = new URL(page.url()).origin;
  expect(
    (
      await page.request.post('/api/beta', {
        headers: { origin, 'x-thrift-user': actor },
        data: { action: 'revoke', email: 'friend@example.test' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await other.request.get('/api/photos?path=' + encodeURIComponent(friendPath))).status(),
  ).toBe(404);
  const denied = await other.request.delete('/api/profile', {
    headers: { origin, 'x-thrift-user': friend },
  });
  expect(denied.status()).toBe(401);
  const after = await (await request.get(authOrigin + '/__metrics')).json();
  expect(after.businessWrites).toBe(0);
  expect(after.profileUpdates).toEqual([actor, friend]);
  await other.close();
});
