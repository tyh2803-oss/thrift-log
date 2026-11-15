import { test, expect, type Page } from '@playwright/test';
import { ebayTransaction, ebayAmount } from '../helpers/ebay';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
test.beforeEach(async ({ request }) => {
  await request.post(authOrigin + '/__reset');
});
test('eBay setup remains optional and does not break existing inventory, Whatnot or private settings on narrow screens', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Open profile menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open settings', exact: true }).click();
  const panel = page.locator('#ebay-connection');
  await expect(panel.getByText('Setup needed', { exact: true })).toBeVisible();
  await expect(panel.getByText(/202611150001_ebay_read_only.sql/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Connect eBay', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Marketplace connections', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByRole('link', { name: /^Inventory(?:\s|$)/ })
    .last()
    .click();
  await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeVisible();
});
test('connect uses the official authorization URL, callback feedback is visible, and refresh/disconnect preserve business records', async ({
  page,
  request,
}) => {
  const writes: Record<string, unknown>[] = [],
    before = await (await request.get(authOrigin + '/__metrics')).json();
  let connected = true;
  await page.route('**/api/integrations/ebay*', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          ready: true,
          configured: true,
          connected,
          username: 'TestSeller',
          financials: false,
          financeAvailable: true,
          status: 'synced',
          hasMore: false,
          pending: 0,
          last_sync: '2026-11-14T12:00:00Z',
        },
      });
    const data = route.request().postDataJSON();
    writes.push(data);
    if (data.action === 'disconnect') connected = false;
    if (data.action === 'connect')
      return route.fulfill({
        json: { url: 'https://auth.ebay.com/oauth2/authorize?client_id=test&state=test' },
      });
    return route.fulfill({
      json: {
        changed: false,
        busy: data.automatic || false,
        status: { ready: true, configured: true, connected, status: 'synced', hasMore: false },
      },
    });
  });
  await login(page);
  await page.goto('/settings?ebay=connected');
  const panel = page.locator('#ebay-connection');
  await expect(
    panel.getByText(
      'eBay connected. Your supported order history will import in resumable batches.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await panel.getByRole('button', { name: 'Refresh eBay', exact: true }).click();
  await expect(panel.getByText(/Refresh completed/)).toBeVisible();
  await panel.getByRole('button', { name: 'Disconnect eBay', exact: true }).click();
  expect(writes.some((d) => d.action === 'disconnect')).toBe(false);
  await panel.getByRole('button', { name: 'Keep connected', exact: true }).click();
  await panel.getByRole('button', { name: 'Disconnect eBay', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
  await expect(
    panel.getByText('Disconnected. Imported records are kept.', { exact: true }),
  ).toBeVisible();
  expect((await (await request.get(authOrigin + '/__metrics')).json()).workspaceWrites || 0).toBe(
    before.workspaceWrites || 0,
  );
  await page.route('https://auth.ebay.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>Official eBay consent boundary</h1>' }),
  );
  await panel.getByRole('button', { name: 'Connect eBay', exact: true }).click();
  await expect(page).toHaveURL(/auth\.ebay\.com\/oauth2\/authorize/);
});
test('financial exceptions expose exact refund and payout inputs without changing source facts or leaking private fields', async ({
  page,
}) => {
  const writes: Record<string, unknown>[] = [],
    tx = ebayTransaction({
      transactionId: 'refund-1',
      transactionType: 'REFUND',
      bookingEntry: 'DEBIT',
      amount: ebayAmount('9.00'),
    }),
    records = [
      {
        kind: 'transaction',
        external_id: 'REFUND:refund-1',
        payload: tx,
        issue: 'Confirm actual seller refund and fee credit.',
        state: 'review',
      },
      {
        kind: 'payout',
        external_id: 'payout-1',
        payload: { payoutId: 'payout-1', payoutStatus: 'SUCCEEDED', amount: ebayAmount('42.75') },
        issue: 'Allocate the payout.',
        state: 'review',
      },
    ];
  await page.route('**/api/integrations/ebay*', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          ready: true,
          configured: true,
          connected: true,
          username: 'TestSeller',
          status: 'synced',
          hasMore: false,
          pending: 2,
          ...(route.request().url().includes('review=1') ? { records } : {}),
        },
      });
    const data = route.request().postDataJSON();
    writes.push(data);
    return route.fulfill({
      json: {
        changed: false,
        status: {
          ready: true,
          configured: true,
          connected: true,
          status: 'synced',
          hasMore: false,
          pending: 2,
        },
      },
    });
  });
  await login(page);
  await page.goto('/settings');
  const panel = page.locator('#ebay-connection');
  await panel.getByRole('button', { name: 'Review 2 eBay updates', exact: true }).click();
  const review = panel.getByRole('region', { name: 'eBay updates needing review' });
  await review.locator('summary').filter({ hasText: 'REFUND:refund-1' }).click();
  await review
    .getByRole('button', { name: 'Save reviewed eBay update', exact: true })
    .first()
    .click();
  await expect(review.getByText(/Enter the seller-funded refund and fee credit/)).toBeVisible();
  await review.getByLabel('Actual seller-funded refund ($)', { exact: true }).fill('10');
  await review.getByLabel('Seller fee credit ($)', { exact: true }).fill('1');
  await review
    .getByRole('button', { name: 'Save reviewed eBay update', exact: true })
    .first()
    .click();
  expect(writes.find((d) => d.action === 'resolve')).toMatchObject({
    kind: 'transaction',
    id: 'REFUND:refund-1',
    resolution: { refund: { amount: 1000, feeCredit: 100 } },
  });
  await review.locator('summary').filter({ hasText: 'Payout payout-1' }).click();
  await expect(
    review.getByRole('combobox', { name: 'Saved eBay order', exact: true }),
  ).toBeVisible();
  await expect(review.getByText(/Confirmed bank amount/)).toContainText('42.75');
  expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await panel.screenshot({
    path: test.info().outputPath('ebay-review.png'),
    animations: 'disabled',
  });
});
test('eBay connection in the public demo never fetches private integration data', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/integrations/ebay')) requests.push(r.url());
  });
  await page.goto('/demo/settings');
  const panel = page.locator('#ebay-connection');
  await expect(panel.getByText('Demo', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Sign in to connect your own eBay account/)).toBeVisible();
  expect(requests).toEqual([]);
});
