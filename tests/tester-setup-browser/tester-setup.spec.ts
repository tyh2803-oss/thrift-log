import { test, expect, devices } from '@playwright/test';
const ownerId = '11111111-1111-4111-8111-111111111111';
const friendId = '22222222-2222-4222-8222-222222222222';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_TESTER_SETUP_PORT || 3171) + 1}`;
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${authOrigin}/__reset`)).ok()).toBe(true);
});
async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
test('owner privately shares a setup link; invited friend chooses a password and keeps the same account, records and isolation', async ({
  page,
  context,
  browser,
  request,
  baseURL,
}) => {
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, 'owner@example.test', 'Owner123');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Beta testers', exact: true })).toBeVisible();
  const row = page.locator('.beta-access .detail-row').filter({ hasText: 'friend@example.test' });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('existing account');
    await dialog.accept();
  });
  await row.getByRole('button', { name: 'Set up tester account', exact: true }).click();
  const panel = page.getByRole('group', { name: 'Private tester setup link', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Copy private setup link', exact: true }).click();
  await expect(page.locator('.beta-access').getByRole('status')).toContainText('copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).pathname).toBe('/setup-tester');
  expect(new URL(link).search).toBe('');
  expect(new URL(link).hash).toContain('token_hash=');
  await expect(page.locator('body')).not.toContainText('token_hash=');
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes('token_hash'),
    ),
  ).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('owner-setup.png'), fullPage: true });

  const friendContext = await browser.newContext({
    baseURL,
    ...(test.info().project.name === 'mobile'
      ? {
          viewport: devices['iPhone 13'].viewport,
          userAgent: devices['iPhone 13'].userAgent,
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 3,
        }
      : { viewport: { width: 1280, height: 800 } }),
  });
  try {
    const friend = await friendContext.newPage();
    const requestedUrls: string[] = [];
    friend.on('request', (r) => requestedUrls.push(r.url()));
    await friend.goto(link);
    await expect(friend).toHaveURL(`${baseURL}/setup-tester`);
    await expect(
      friend.getByRole('button', { name: 'Continue to set password', exact: true }),
    ).toBeEnabled();
    expect(requestedUrls.every((url) => !new URL(url).hash)).toBe(true);
    await expect(friend.locator('body')).not.toContainText('token_hash=');
    expect(await friend.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await friend.screenshot({ path: test.info().outputPath('friend-setup.png'), fullPage: true });
    await friend.getByRole('button', { name: 'Continue to set password', exact: true }).click();
    await expect(friend).toHaveURL(`${baseURL}/set-password`);
    await friend.getByLabel('New password', { exact: true }).fill('Friend12');
    await friend.getByLabel('Confirm password', { exact: true }).fill('Mismatch1');
    await friend.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect(friend.locator('form').getByRole('alert')).toContainText('Passwords must match');
    await friend.getByLabel('Confirm password', { exact: true }).fill('Friend12');
    await friend.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect(friend).toHaveURL(`${baseURL}/`);
    await friend.goto(`${baseURL}/inventory`);
    await expect(friend.locator('body')).toContainText('Friend retained jacket');
    await expect(friend.locator('body')).not.toContainText('Owner private jacket');
    const own = await friend.request.get(`${baseURL}/api/workspace?userId=${ownerId}`);
    expect(own.status()).toBe(200);
    expect((await own.json()).items[0].title).toBe('Friend retained jacket');
    expect(
      (
        await friend.request.get(`${baseURL}/api/workspace`, {
          headers: { 'x-thrift-user': ownerId },
        })
      ).status(),
    ).toBe(401);
    expect((await friend.request.get(`${baseURL}/api/beta`)).status()).toBe(403);
    expect(
      (await friend.request.get(`${baseURL}/api/photos?path=${ownerId}/retained.png`)).status(),
    ).toBe(404);
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token_hash');
    expect(
      (
        await request.post('/api/tester-setup', {
          headers: { Origin: baseURL! },
          data: { token_hash: token },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await friend.request.post(`${baseURL}/api/auth`, {
          headers: { Origin: baseURL! },
          data: { action: 'signout' },
        })
      ).status(),
    ).toBe(200);
    await signIn(friend, 'friend@example.test', 'Friend12');
    await friend.goto(`${baseURL}/settings`);
    await expect(friend.getByRole('heading', { name: 'Beta testers', exact: true })).toHaveCount(0);
    const after = await (await request.get(`${authOrigin}/__metrics`)).json();
    expect(after.users.map((u: { id: string }) => u.id)).toEqual(
      before.users.map((u: { id: string }) => u.id),
    );
    expect(after.workspaces).toEqual(before.workspaces);
    expect(after.passwordUpdates).toEqual([friendId]);
    expect(after.generatedFor).toEqual([friendId]);
    expect(after.businessWrites).toBe(0);
    expect(after.unexpectedWrites).toBe(0);
  } finally {
    await friendContext.close();
  }
});
test('missing, expired and revoked setup links fail safely and cannot be issued by a tester or an anonymous request', async ({
  page,
  request,
  baseURL,
}) => {
  expect(
    (
      await request.post('/api/beta', {
        headers: { Origin: baseURL! },
        data: { action: 'setup', email: 'friend@example.test' },
      })
    ).status(),
  ).toBe(403);
  await page.goto('/setup-tester');
  await expect(page.locator('.login-card').getByRole('alert')).toContainText('missing or invalid');
  await expect(
    page.getByRole('button', { name: 'Continue to set password', exact: true }),
  ).toBeDisabled();
  await page.goto(`/setup-tester#token_hash=${'a'.repeat(64)}`);
  await page.getByRole('button', { name: 'Continue to set password', exact: true }).click();
  await expect(page.locator('.login-card').getByRole('alert')).toContainText(
    'invalid, expired, already used',
  );
  await signIn(page, 'owner@example.test', 'Owner123');
  const issued = await page.request.post('/api/beta', {
    headers: { Origin: baseURL! },
    data: { action: 'setup', email: 'friend@example.test' },
  });
  expect(issued.status()).toBe(200);
  const link = (await issued.json()).setup.link;
  expect(
    (
      await page.request.post('/api/beta', {
        headers: { Origin: baseURL! },
        data: { action: 'revoke', email: 'friend@example.test' },
      })
    ).status(),
  ).toBe(200);
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token_hash');
  expect(
    (
      await request.post('/api/tester-setup', {
        headers: { Origin: baseURL! },
        data: { token_hash: token },
      })
    ).status(),
  ).toBe(400);
  expect((await page.request.get('/api/workspace')).status()).toBe(200);
  const metrics = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(metrics.passwordUpdates).toEqual([]);
  expect(metrics.users).toHaveLength(3);
  expect(metrics.businessWrites).toBe(0);
});
