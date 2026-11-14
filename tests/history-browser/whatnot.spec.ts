import { test, expect } from '@playwright/test';
import { whatnotSource, whatnotShow, whatnotAnalytics } from '../helpers/whatnot';
import type { ConnectionStatus, StoredRecord } from '../../src/lib/integrations/whatnot/schema';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
const owner = '11111111-1111-4111-8111-111111111111';
const item = '44444444-4444-4444-8444-444444444444';
let status: ConnectionStatus,
  records: StoredRecord[],
  actions: { action: string; resolution?: unknown; token?: string }[];
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${authOrigin}/__reset`)).ok()).toBe(true);
  status = { ready: true, connected: false };
  records = [];
  actions = [];
  await page.route('**/api/integrations/whatnot**', async (route) => {
    if (route.request().url().includes('/shows/'))
      return route.fulfill({ json: { analytics: whatnotAnalytics } });
    if (route.request().method() === 'GET') return route.fulfill({ json: { ...status, records } });
    const data = route.request().postDataJSON();
    actions.push(data);
    if (data.action === 'connect')
      status = {
        ready: true,
        connected: true,
        username: 'synthetic-seller',
        status: 'synced',
        last_sync: '2026-11-12T12:00:00Z',
        hasMore: false,
        pending: records.length,
        webhook_id: crypto.randomUUID(),
        has_webhook: false,
      };
    if (data.action === 'disconnect') {
      status = { ready: true, connected: false };
      records = [];
    }
    if (data.action === 'resolve') {
      records = [];
      status = { ...status, pending: 0 };
    }
    return route.fulfill({
      json:
        data.action === 'sync' || data.action === 'resolve'
          ? { status, changed: false, hasMore: false }
          : status,
    });
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
});
test('private Whatnot connection, manual refresh and disconnect remain mobile friendly, never persist the token in browser storage, and preserve account data', async ({
  page,
  request,
}) => {
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  await page.clock.install();
  await page.goto('/settings');
  const region = page.getByRole('region', { name: 'Whatnot connection', exact: true });
  await expect(region.getByText('Not connected', { exact: true })).toBeVisible();
  const token = 'wn_pat_tk_browser_test_credential';
  await region.getByLabel('Whatnot personal access token', { exact: true }).fill(token);
  await region.getByRole('button', { name: 'Connect & import read-only', exact: true }).click();
  await expect(region.getByText('@synthetic-seller', { exact: true })).toBeVisible();
  await expect(region.getByLabel('Whatnot personal access token', { exact: true })).toHaveValue('');
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    ),
  ).not.toContain(token);
  await region.getByRole('button', { name: 'Refresh Whatnot', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Refresh Whatnot', exact: true })).toBeEnabled();
  expect(actions.some((a) => a.action === 'sync')).toBe(true);
  status = { ...status, status: 'partial', hasMore: true, progress: 'orders' };
  await page.clock.fastForward(16000);
  await expect(region.getByText('Importing orders…', { exact: true })).toBeVisible();
  status = { ...status, status: 'synced', hasMore: false };
  await page.clock.fastForward(16000);
  await expect(region.getByText('synced', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('whatnot-connection.png'), fullPage: true });
  await region.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(region.getByText('Not connected', { exact: true })).toBeVisible();
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.workspaces).toEqual(before.workspaces);
  expect(after.businessWrites).toBe(0);
  expect(after.unexpectedWrites).toBe(0);
});
test('exception review submits owned physical matches and an explicit net-refund breakdown without requiring new credentials', async ({
  page,
}) => {
  status = {
    ready: true,
    connected: true,
    username: 'synthetic-seller',
    status: 'synced',
    pending: 2,
    last_sync: '2026-11-12T12:00:00Z',
  };
  const source = whatnotSource();
  records = [
    {
      kind: 'order',
      external_id: '123456',
      hash: 'a'.repeat(64),
      state: 'review',
      issue: 'Possible existing inventory. Choose the correct physical piece.',
      local_id: null,
      payload: { source, adopted: false },
    },
    {
      kind: 'transaction',
      external_id: 'refund-1',
      hash: 'b'.repeat(64),
      state: 'review',
      issue: 'Enter the actual refund breakdown.',
      local_id: crypto.randomUUID(),
      payload: { type: 'ORDER_REFUND', amount: -3775, orderId: '123456' },
    },
  ];
  await page.goto('/settings');
  const region = page.getByRole('region', { name: 'Whatnot connection', exact: true });
  await region.getByRole('button', { name: 'Review 2 Whatnot updates', exact: true }).click();
  await region.getByText('ORDER_REFUND · refund-1', { exact: true }).click();
  await region.getByLabel('Customer refund ($)', { exact: true }).fill('43');
  await region.getByLabel('Seller fee credit ($)', { exact: true }).fill('5.25');
  await region.getByRole('button', { name: 'Reconcile refund', exact: true }).click();
  await expect.poll(() => actions.filter((a) => a.action === 'resolve').length).toBe(1);
  expect(actions.find((a) => a.action === 'resolve')?.resolution).toEqual({
    refund: { amount: 4300, feeCredit: 525, shippingAdjustment: 0 },
  });
  // Reset the controlled provider response to review a separate physical match.
  status = { ...status, pending: 1 };
  records = [
    {
      kind: 'order',
      external_id: '123456',
      hash: 'c'.repeat(64),
      state: 'review',
      issue: 'Choose existing inventory.',
      local_id: null,
      payload: { source, adopted: false },
    },
  ];
  await page.reload();
  await region.getByRole('button', { name: 'Review 1 Whatnot updates', exact: true }).click();
  await region
    .locator('summary')
    .filter({ hasText: /^Order 123456$/ })
    .click();
  await region
    .getByRole('combobox', { name: 'Physical item · 9123456:0', exact: true })
    .selectOption(item);
  await region.getByRole('button', { name: 'Resolve item matches', exact: true }).click();
  await expect.poll(() => actions.filter((a) => a.action === 'resolve').length).toBe(2);
  expect(actions.filter((a) => a.action === 'resolve')[1].resolution).toEqual({
    units: { '9123456:0': { itemId: item, cost: null } },
  });
});
test('shows setup and provider-estimate states honestly without changing private business revenue or profit', async ({
  page,
  context,
}) => {
  status = { ready: false, connected: false, setup: 'Migration required' };
  await page.goto('/settings');
  const region = page.getByRole('region', { name: 'Whatnot connection', exact: true });
  await expect(region.getByText('Setup needed', { exact: true })).toBeVisible();
  await expect(region.getByLabel('Whatnot personal access token', { exact: true })).toHaveCount(0);
  const r = await context.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } }),
    workspace = await r.json();
  workspace.shows = [
    {
      id: whatnotShow.id,
      externalId: whatnotShow.id,
      name: whatnotShow.title,
      date: whatnotShow.scheduled_start_at,
      type: 'Whatnot',
      status: 'Ended',
      notes: '',
      lineup: [],
      checklist: [],
      durationMinutes: 59,
    },
  ];
  await page.route('**/api/workspace', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: workspace }) : route.abort(),
  );
  await page.goto('/sales');
  await page.getByRole('button', { name: 'Shows & events', exact: true }).click();
  await page.locator('.show-preview').filter({ hasText: whatnotShow.title }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Whatnot show analytics', { exact: true })).toBeVisible();
  await expect(dialog.getByText('$36.75', { exact: true })).toBeVisible();
  await expect(dialog.locator('.metric').filter({ hasText: 'Realized profit' })).toContainText(
    '$0.00',
  );
});

test('bulk Whatnot review splits exact cents across new physical items and retains a real accounting exception for retry', async ({
  page,
}) => {
  status = { ready: true, connected: true, status: 'synced', pending: 3, hasMore: false };
  records = ['100001', '100002', '100003'].map((id) => ({
    kind: 'order',
    external_id: id,
    hash: id.repeat(11).slice(0, 64),
    state: 'review',
    issue: 'Possible existing inventory.',
    local_id: null,
    payload: { source: whatnotSource(id, null), adopted: false },
  }));
  const submitted: {
    id: string;
    resolution: { units: Record<string, { itemId: string; cost: number }> };
  }[][] = [];
  await page.route('**/api/integrations/whatnot', async (route) => {
    if (
      route.request().method() !== 'POST' ||
      route.request().postDataJSON().action !== 'review_batch'
    )
      return route.fallback();
    const entries = route.request().postDataJSON().entries;
    submitted.push(entries);
    records = records.filter((r) => r.external_id === '100003');
    status = { ...status, pending: 1 };
    return route.fulfill({
      json: {
        busy: false,
        changed: false,
        applied: ['100001', '100002'],
        unresolved: [{ id: '100003', issue: 'Order totals do not reconcile.' }],
      },
    });
  });
  await page.goto('/settings');
  const region = page.getByRole('region', { name: 'Whatnot connection', exact: true });
  await region.getByRole('button', { name: 'Review 3 Whatnot updates', exact: true }).click();
  const toolbar = region.getByRole('region', { name: 'Whatnot bulk review' });
  await toolbar.getByRole('button', { name: 'Select all orders (3)', exact: true }).click();
  await toolbar.getByText('Bulk purchase costs for new items', { exact: true }).click();
  await toolbar.getByLabel('Cost mode').selectOption('split');
  await toolbar.getByLabel('Total purchase cost ($)', { exact: true }).fill('5');
  await expect(toolbar.getByText(/3 new physical items included/)).toBeVisible();
  expect(await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await toolbar.getByRole('button', { name: 'Apply costs & import', exact: true }).click();
  await expect(toolbar.getByText('1 selected', { exact: true })).toBeVisible();
  await expect(
    toolbar.getByText('Order 100003: Order totals do not reconcile.', { exact: true }),
  ).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(submitted[0].map((e) => Object.values(e.resolution.units)[0])).toEqual([
    { itemId: 'new', cost: 167 },
    { itemId: 'new', cost: 167 },
    { itemId: 'new', cost: 166 },
  ]);
  await toolbar.getByRole('button', { name: 'Import selected (1)', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1].map((e) => e.id)).toEqual(['100003']);
});
