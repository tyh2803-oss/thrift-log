import { test, expect, type Page, type BrowserContext } from '@playwright/test';
const owner = '11111111-1111-4111-8111-111111111111';
const friend = '22222222-2222-4222-8222-222222222222';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
const navigation = (page: Page) =>
  page.locator(page.viewportSize()!.width < 900 ? '.mobile-nav' : '.sidebar nav');
const navLink = (page: Page, label: string) =>
  navigation(page).getByRole('link', { name: new RegExp(`^${label}(?: \\d+)?$`) });
const origin = (page: Page) => new URL(page.url()).origin;
async function activateFriend(context: BrowserContext, page: Page, friendContext: BrowserContext) {
  const setup = await context.request.post('/api/beta', {
    headers: { origin: origin(page), 'x-thrift-user': owner },
    data: { action: 'setup', email: 'friend@example.test' },
  });
  expect(setup.ok()).toBe(true);
  const link = (await setup.json()).setup.link;
  const hash = new URLSearchParams(new URL(link).hash.slice(1)).get('token_hash');
  const verified = await friendContext.request.post('/api/tester-setup', {
    headers: { origin: origin(page) },
    data: { token_hash: hash },
  });
  expect(verified.ok()).toBe(true);
}
test.beforeEach(async ({ request, page }) => {
  expect((await request.post(`${authOrigin}/__reset`)).ok()).toBe(true);
  await page.goto('/login');
  const status = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/integrations/whatnot',
  );
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  await status;
});
test('tab navigation reuses the private workspace, verifies authorization on every page, and filters stages without server round trips', async ({
  page,
  request,
}) => {
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  let workspaceReads = 0,
    statusReads = 0,
    serverNavigations = 0;
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/workspace') workspaceReads++;
    if (url.pathname === '/api/integrations/whatnot') statusReads++;
    if (r.headers().rsc === '1') serverNavigations++;
  });
  // A deliberately slow route response must have immediate, layout-stable feedback.
  await page.route('**/*', async (route) => {
    if (route.request().headers().rsc === '1') await new Promise((r) => setTimeout(r, 180));
    await route.continue();
  });
  for (const [label, heading] of [
    ['Inventory', 'Every piece, in its place.'],
    ['Sales', 'Good finds. Great sales.'],
    ['Home', 'A good day for good finds.'],
    ['Inventory', 'Every piece, in its place.'],
  ]) {
    await navLink(page, label).click();
    await expect(
      page.locator('.navigation-progress.is-pending').filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(label === 'Home' ? '/$' : '/' + label.toLowerCase() + '$'),
    );
    await expect(page.locator('.navigation-progress.is-pending')).toHaveCount(0);
    await expect(page.getByText('Getting your workspace ready…', { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText('Owner private jacket', { exact: true })).toBeVisible();
  expect(workspaceReads).toBe(0);
  expect(statusReads).toBe(0);
  const count = serverNavigations;
  const stage = page.getByRole('combobox', { name: 'Filter inventory status', exact: true });
  for (const value of ['shipped', 'sold', 'for-sale', 'unlisted', 'all']) {
    await stage.selectOption(value);
    await expect(stage).toHaveValue(value);
    await expect(page.locator('table tbody tr')).toHaveCount(
      value === 'all' || value === 'unlisted' ? 1 : 0,
    );
  }
  expect(serverNavigations).toBe(count);
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.authReads - before.authReads).toBe(4);
  expect(after.accessChecks - before.accessChecks).toBe(4);
  expect(after.workspaceReads).toBe(before.workspaceReads);
  expect(after.workspaces).toEqual(before.workspaces);
  expect(after.businessWrites).toBe(0);
});
test('background checks coalesce and return no workspace payload until another device saves a newer revision', async ({
  page,
  context,
  request,
}) => {
  await navLink(page, 'Inventory').click();
  await expect(page.getByText('Owner private jacket', { exact: true })).toBeVisible();
  let release!: () => void,
    reads = 0;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/workspace?revision=*', async (route) => {
    reads++;
    await held;
    await route.continue();
  });
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  const checked = page.waitForResponse((r) => r.url().includes('/api/workspace?revision='));
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(() => reads).toBe(1);
  release();
  expect((await checked).status()).toBe(304);
  const unchanged = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(unchanged.workspaceReads).toBe(before.workspaceReads);
  expect(unchanged.versionReads - before.versionReads).toBe(1);
  const w = await (
    await context.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
  ).json();
  const saved = await context.request.post('/api/workspace', {
    headers: { origin: origin(page), 'x-thrift-user': owner },
    data: {
      revision: w.revision,
      commands: [{ type: 'item', value: { ...w.items[0], title: 'Owner background update' } }],
    },
  });
  expect(saved.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Owner background update', { exact: true })).toBeVisible();
  await expect(page.getByText('Owner private jacket', { exact: true })).toHaveCount(0);
  expect((await (await request.get(`${authOrigin}/__metrics`)).json()).workspaces[friend]).toEqual(
    before.workspaces[friend],
  );
});
test('a slow read cannot replace a newer confirmed save and failed saves keep business data unchanged until retry succeeds', async ({
  page,
  context,
  request,
}) => {
  const old = await (
    await context.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
  ).json();
  await navLink(page, 'Inventory').click();
  const cost = page.getByRole('spinbutton', { name: 'Cost for RETAINED-1', exact: true });
  await expect(cost).toHaveValue('12.00');
  let release!: () => void,
    began = false,
    posts = 0;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/workspace?revision=*', async (route) => {
    began = true;
    await gate;
    await route.fulfill({ json: old });
  });
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      if (posts === 2) {
        await new Promise((r) => setTimeout(r, 150));
        return route.fulfill({
          status: 503,
          json: { error: 'Simulated save failure. Retry your change.' },
        });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => began).toBe(true);
  await cost.fill('13');
  await cost.blur();
  await expect(page.locator('.environment-banner')).toContainText('Saving…');
  await expect(cost).toHaveValue('13.00');
  const stale = page.waitForResponse((r) => r.url().includes('/api/workspace?revision='));
  release();
  await stale;
  await expect(cost).toHaveValue('13.00');
  await expect(page.locator('.inventory-stats')).toContainText('$13.00');
  const backgroundCheck = page.waitForResponse((r) => r.url().includes('/api/workspace?revision='));
  await cost.fill('14');
  await cost.blur();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await backgroundCheck;
  await expect(page.getByRole('alert').filter({ hasText: 'Simulated save failure' })).toContainText(
    'Simulated save failure',
  );
  await expect(page.locator('.inventory-stats')).toContainText('$13.00');
  await cost.fill('14');
  await cost.blur();
  await expect(cost).toHaveValue('14.00');
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.businessWrites).toBe(2);
  expect(after.workspaces[owner].items).toHaveLength(1);
  expect(after.workspaces[owner].items[0].cost).toBe(1400);
});
test('switching Auth accounts cannot reuse another user’s persistent workspace or owner controls', async ({
  page,
  context,
  browser,
  baseURL,
  request,
}) => {
  const friendContext = await browser.newContext({ baseURL });
  try {
    await activateFriend(context, page, friendContext);
    await context.addCookies(await friendContext.cookies(baseURL));
    await navLink(page, 'Inventory').click();
    await expect(page.getByText('Friend retained jacket', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText('Owner private jacket', { exact: true })).toHaveCount(0);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Beta testers', exact: true })).toHaveCount(0);
    const own = await context.request.get(`/api/workspace?user_id=${owner}&revision=0`, {
      headers: { 'x-thrift-user': friend },
    });
    expect(own.ok()).toBe(true);
    expect((await own.json()).items[0].title).toBe('Friend retained jacket');
    const metrics = await (await request.get(`${authOrigin}/__metrics`)).json();
    expect(metrics.workspaces[owner].items[0].title).toBe('Owner private jacket');
    expect(metrics.businessWrites).toBe(0);
  } finally {
    await friendContext.close();
  }
});
test('revocation still blocks fresh navigation and revision checks without deleting the cached user’s business records', async ({
  page,
  context,
  browser,
  baseURL,
  request,
}) => {
  const friendContext = await browser.newContext({ baseURL, viewport: page.viewportSize()! });
  try {
    await activateFriend(context, page, friendContext);
    const friendPage = await friendContext.newPage();
    await friendPage.goto('/');
    await expect(
      friendPage.getByRole('region', { name: 'Inventory Pipeline', exact: true }),
    ).toBeVisible();
    const before = await (await request.get(`${authOrigin}/__metrics`)).json();
    const revoked = await context.request.post('/api/beta', {
      headers: { origin: origin(page), 'x-thrift-user': owner },
      data: { action: 'revoke', email: 'friend@example.test' },
    });
    expect(revoked.ok()).toBe(true);
    const blocked = await friendContext.request.get('/api/workspace?revision=1', {
      headers: { 'x-thrift-user': friend },
    });
    expect(blocked.status()).toBe(401);
    await navLink(friendPage, 'Inventory').click();
    await expect(friendPage).toHaveURL(/\/login$/, { timeout: 20000 });
    await expect(friendPage.getByText('Friend retained jacket', { exact: true })).toHaveCount(0);
    const after = await (await request.get(`${authOrigin}/__metrics`)).json();
    expect(after.workspaces).toEqual(before.workspaces);
    expect(after.businessWrites).toBe(0);
  } finally {
    await friendContext.close();
  }
});

test('an authorized response already in flight cannot resurrect private cached data after access is invalidated', async ({
  page,
  request,
}) => {
  await navLink(page, 'Inventory').click();
  let releaseRead!: () => void, releaseSave!: () => void;
  let readStarted = false,
    savedOnServer = false;
  const readGate = new Promise<void>((r) => {
    releaseRead = r;
  });
  const saveGate = new Promise<void>((r) => {
    releaseSave = r;
  });
  await page.route('**/api/workspace?revision=*', async (route) => {
    readStarted = true;
    await readGate;
    await route.fulfill({ status: 401, json: { error: 'Sign in to continue.' } });
  });
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    savedOnServer = true;
    await saveGate;
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => readStarted).toBe(true);
  const cost = page.getByRole('spinbutton', { name: 'Cost for RETAINED-1', exact: true });
  await cost.fill('13');
  await cost.blur();
  await expect.poll(() => savedOnServer).toBe(true);
  const invalid = page.waitForResponse((r) => r.url().includes('/api/workspace?revision='));
  releaseRead();
  expect((await invalid).status()).toBe(401);
  await expect(page.getByText('Owner private jacket', { exact: true })).toHaveCount(0);
  releaseSave();
  await expect(page.locator('.error-box')).toContainText('Your session changed');
  await expect(page.getByText('Owner private jacket', { exact: true })).toHaveCount(0);
  const metrics = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(metrics.businessWrites).toBe(1);
  expect(metrics.workspaces[owner].items[0].cost).toBe(1300);
  await page.reload();
  await expect(
    page.getByRole('spinbutton', { name: 'Cost for RETAINED-1', exact: true }),
  ).toHaveValue('13.00');
});

test('the public demo and private workspace keep separate layouts and never transfer records or private caches', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  await page.goto('/demo/inventory');
  await expect(page.locator('.environment-banner')).toContainText('Demo workspace');
  await expect(page.getByText('Owner private jacket', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage }).includes('Owner private jacket')),
  ).toBe(false);
  await page.goto('/inventory');
  await expect(page.getByText('Owner private jacket', { exact: true })).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  const publicContext = await browser.newContext({ baseURL });
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto('/demo');
    await expect(
      publicPage.getByRole('region', { name: 'Inventory Pipeline', exact: true }),
    ).toBeVisible();
    await expect(publicPage.locator('.environment-banner')).toContainText('Demo workspace');
  } finally {
    await publicContext.close();
  }
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.workspaces).toEqual(before.workspaces);
  expect(after.businessWrites).toBe(0);
});

test('cached tab content paints before a slow server navigation completes and Back restores the right view', async ({
  page,
  request,
}) => {
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = false;
  await page.route('**/*', async (route) => {
    if (route.request().headers().rsc === '1' && !blocked) {
      blocked = true;
      await held;
    }
    await route.continue();
  });
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await navLink(page, 'Inventory').click();
    await expect(
      page.getByRole('heading', { name: 'Every piece, in its place.', exact: true }),
    ).toBeVisible({ timeout: 1000 });
    await expect(
      page.getByRole('heading', { name: 'Every piece, in its place.', exact: true }),
    ).toBeInViewport();
    await expect(page.getByText('Owner private jacket', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/); // the authoritative navigation is deliberately still held
  } finally {
    release();
  }
  await expect(page).toHaveURL(/\/inventory$/);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'A good day for good finds.', exact: true }),
  ).toBeVisible();
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.authReads).toBeGreaterThan(before.authReads);
  expect(after.accessChecks).toBeGreaterThan(before.accessChecks);
  expect(after.workspaces).toEqual(before.workspaces);
  expect(after.businessWrites).toBe(0);
});
