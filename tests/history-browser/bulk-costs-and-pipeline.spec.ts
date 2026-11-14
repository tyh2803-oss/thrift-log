import { test, expect } from '@playwright/test';
import { workspaceSchema, itemSchema, orderSchema } from '../../src/lib/model';
import { historyCsvSources, historyMapping } from '../../src/lib/assistant/csv-history';
import { createHistoryBatch } from '../../src/lib/assistant/history';
import { readCsv } from '../../src/lib/csv';
import { metrics } from '../../src/lib/finance';
const owner = '11111111-1111-4111-8111-111111111111';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
test.beforeEach(async ({ page, request }) => {
  await request.post(`${authOrigin}/__reset`);
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
});
const headers = (url: string) => ({ 'x-thrift-user': owner, Origin: new URL(url).origin });
test('split purchase costs for saved sales persist exact cents, keep original sale lines and replay a lost response without duplicate corrections', async ({
  page,
  request,
}) => {
  const w = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  const text =
      'Item,Price,Date,Fees\nCoat A,25,2026-11-10,1\nCoat B,25,2026-11-10,1\nCoat C,25,2026-11-10,1\nCoat D,25,2026-11-10,1',
    sources = await historyCsvSources(text, 'source.csv', {
      mapping: historyMapping(readCsv(text).columns),
      marketplace: 'Depop',
      dateFormat: 'auto',
      allowIncomplete: true,
    }),
    batch = createHistoryBatch(sources, w);
  const approved = await page.request.post('/api/assistant/approve', {
    headers: headers(page.url()),
    data: { mode: 'history', batch, rowIds: batch.rows.map((r) => r.id) },
  });
  expect(approved.ok()).toBe(true);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Bulk purchase costs', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bulk purchase costs' });
  await expect(dialog.getByText(/5 matching physical items · 4 selected/)).toBeVisible();
  await dialog.getByLabel('Cost entry', { exact: true }).selectOption('split');
  await dialog.getByLabel('Batch purchase amount', { exact: true }).fill('5.01');
  const included = dialog.locator('.bulk-cost-item input[inputmode=decimal]:enabled');
  await expect(included).toHaveCount(4);
  await expect(included.first()).toHaveValue('1.26');
  await expect(included.nth(1)).toHaveValue('1.25');
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath('bulk-purchase-costs.png') });
  let payload: unknown;
  let posts = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/purchase-costs') && r.method() === 'POST') {
      posts++;
      payload = r.postDataJSON();
    }
  });
  await dialog.getByRole('button', { name: 'Apply purchase costs (4)', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toBe(1);
  const saved = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  expect(saved.orders).toHaveLength(4);
  expect(saved.orders.every((o) => o.lines[0].costBasis === 0)).toBe(true);
  expect(saved.financialEvents.map((e) => e.amount).sort((a, b) => a - b)).toEqual([
    125, 125, 125, 126,
  ]);
  expect(metrics(saved)).toMatchObject({ cogs: 501, profit: 9099, unknownCosts: 0 });
  expect(saved.items.find((i) => i.id === w.items[0].id)!.cost).toBe(1200);
  const replay = await page.request.post('/api/purchase-costs', {
    headers: headers(page.url()),
    data: payload,
  });
  expect((await replay.json()).replayed).toBe(true);
  await page.reload();
  await page.getByRole('link', { name: 'Sales', exact: true }).click();
  await page.getByRole('button', { name: 'Bulk purchase costs', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText(/4 matching physical items · 0 selected/),
  ).toBeVisible();
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.businessWrites).toBe(2);
});

test('a large shipped-stage move can be submitted at the top without scrolling through 132 items or entering sale defaults', async ({
  page,
}) => {
  test.setTimeout(60000);
  const w = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  const commands = Array.from({ length: 132 }, (_, i) => {
    const item = itemSchema.parse({
      id: crypto.randomUUID(),
      sku: `BULK-STAGE-${i}`,
      title: `Stage piece ${i}`,
      cost: 100,
      asking: 2500,
      purchasedAt: '2026-11-01T12:00:00Z',
      createdAt: '2026-11-01T12:00:00Z',
      status: 'Purchased',
    });
    return [
      { type: 'item', value: item },
      {
        type: 'order',
        value: orderSchema.parse({
          id: crypto.randomUUID(),
          externalId: `STAGE-${i}`,
          marketplace: 'Depop',
          date: '2026-11-12T12:00:00Z',
          lines: [{ itemId: item.id, price: 2500, costBasis: 100 }],
          fees: 100,
          processing: 0,
          shipping: 0,
          shippingCollected: 0,
          discount: 0,
          other: 0,
          packaging: 0,
          refund: 0,
          feeCredit: 0,
          adjustment: 0,
          tips: 0,
          showId: null,
          type: 'Sale',
          status: 'Completed',
          fulfillment: 'Unfulfilled',
          payout: 'Pending',
        }),
      },
    ];
  }).flat();
  const response = await page.request.post('/api/workspace', {
    headers: headers(page.url()),
    data: { revision: w.revision, commands },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/inventory?pipeline=sold');
  await page.getByRole('button', { name: 'Select all matching (132)', exact: true }).click();
  await page.getByLabel('Bulk destination', { exact: true }).selectOption('shipped');
  await page.getByRole('button', { name: 'Move selected (132)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change pipeline status' });
  await expect(dialog.getByText('132 physical items selected', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Shared marketplace', { exact: true })).toHaveCount(0);
  const top = dialog.getByRole('button', { name: 'Save status changes at top', exact: true });
  await expect(top).toBeInViewport();
  expect((await top.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath('pipeline-top-save.png') });
  await top.click();
  await expect(dialog).toHaveCount(0, { timeout: 20000 });
  const saved = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  expect(saved.orders).toHaveLength(132);
  expect(saved.orders.every((o) => o.fulfillment === 'Shipped')).toBe(true);
  expect(saved.financialEvents).toHaveLength(0);
  expect(saved.orders.every((o) => o.lines[0].costBasis === 100)).toBe(true);
});

test('dashboard profit opens missing-cost review, saves from the top, and updates profit after reload', async ({
  page,
}) => {
  const { soldCostFixture } = await import('../helpers/purchase-costs');
  const initial = await soldCostFixture();
  const current = await (
    await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
  ).json();
  const commands = [
    { type: 'item', value: { ...initial.items[0], status: 'Purchased' } },
    { type: 'order', value: initial.orders[0] },
    { type: 'import', value: initial.imports[0] },
  ];
  expect(
    (
      await page.request.post('/api/workspace', {
        headers: headers(page.url()),
        data: { revision: current.revision, commands },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  const profit = page.getByRole('button', {
    name: 'Review profit and missing information',
    exact: true,
  });
  await expect(profit).toContainText('purchase costs unknown');
  await profit.click();
  const review = page.getByRole('dialog', { name: 'Review profit', exact: true });
  await review.getByRole('button', { name: 'Edit purchase costs (1)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bulk purchase costs', exact: true });
  await dialog.getByLabel('Batch purchase amount', { exact: true }).fill('3');
  const save = dialog.getByRole('button', { name: 'Save purchase costs at top', exact: true });
  await expect(save).toBeInViewport();
  await expect(save).toBeEnabled();
  await save.evaluate((el: HTMLButtonElement) => {
    el.click();
    el.click();
  });
  await expect(review.getByRole('status')).toContainText('Profit is complete: $30.00.');
  await review.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(profit).toContainText('$30.00');
  await expect(profit).not.toContainText('incomplete');
  await page.reload();
  await expect(profit).toContainText('$30.00');
  const saved = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  expect(saved.financialEvents).toHaveLength(1);
  expect(saved.orders[0].lines[0].costBasis).toBe(0);
});

test('495-item purchase review wraps long SKUs, warns about setup before saving and retains inputs through recovery', async ({
  page,
}) => {
  test.setTimeout(120000);
  const { soldCostFixture } = await import('../helpers/purchase-costs');
  const original = await soldCostFixture();
  const commands = Array.from({ length: 495 }, (_, n) => {
    const itemId = crypto.randomUUID(),
      orderId = crypto.randomUUID();
    const audit = JSON.parse(original.imports[0].rawCsv);
    audit.unknownCostItemIds = [itemId];
    return [
      {
        type: 'item',
        value: {
          ...original.items[0],
          status: 'Purchased',
          id: itemId,
          sku: `WN-${itemId}`,
          title: `$1 STARTS #${n + 1}`,
        },
      },
      {
        type: 'order',
        value: {
          ...original.orders[0],
          id: orderId,
          externalId: `BULK-REVIEW-${n}`,
          importKey: `BULK-REVIEW-${n}`,
          lines: [{ ...original.orders[0].lines[0], itemId }],
        },
      },
      {
        type: 'import',
        value: {
          ...original.imports[0],
          id: orderId,
          recordIds: [orderId, itemId],
          rawCsv: JSON.stringify(audit),
        },
      },
    ];
  }).flat();
  for (let start = 0; start < commands.length; start += 750) {
    const current = await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json();
    const response = await page.request.post('/api/workspace', {
      headers: headers(page.url()),
      data: { revision: current.revision, commands: commands.slice(start, start + 750) },
    });
    expect(response.ok()).toBe(true);
  }
  let ready = false,
    writes = 0;
  await page.route('**/api/purchase-costs', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { savedSaleCosts: ready } });
    writes++;
    return route.continue();
  });
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Bulk purchase costs', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bulk purchase costs', exact: true });
  await expect(dialog.getByRole('status')).toContainText('one-time administrator setup');
  await expect(dialog.getByText(/496 matching physical items · 200 selected/)).toBeVisible();
  await dialog.getByLabel('Batch purchase amount', { exact: true }).fill('3');
  const save = dialog.getByRole('button', { name: 'Save purchase costs at top', exact: true });
  await expect(save).toBeDisabled();
  expect(writes).toBe(0);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const firstInput = dialog.locator('.bulk-cost-item input[inputmode=decimal]:enabled').first();
  const bounds = await firstInput.boundingBox(),
    db = await dialog.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(db!.x + db!.width);
  await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(save).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog
    .getByRole('button', { name: 'Check setup again', exact: true })
    .scrollIntoViewIfNeeded();
  ready = true;
  await dialog.getByRole('button', { name: 'Check setup again', exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(dialog.getByLabel('Batch purchase amount', { exact: true })).toHaveValue('3');
  await page.screenshot({ path: test.info().outputPath('large-purchase-costs.png') });
  await save.click();
  await expect(dialog).toHaveCount(0, { timeout: 60000 });
  expect(writes).toBe(1);
  const saved = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  expect(saved.orders).toHaveLength(495);
  expect(saved.financialEvents).toHaveLength(200);
  expect(saved.financialEvents.every((e) => e.amount === 300)).toBe(true);
  expect(metrics(saved).unknownCosts).toBe(295);
  await page.reload();
  await page.getByRole('button', { name: 'Bulk purchase costs', exact: true }).click();
  await expect(dialog.getByText(/496 matching physical items · 200 selected/)).toBeVisible();
});
