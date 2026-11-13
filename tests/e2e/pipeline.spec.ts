import { test, expect, type Page } from '@playwright/test';
import {
  emptyWorkspace,
  itemSchema,
  listingSchema,
  orderSchema,
  type Workspace,
} from '../../src/lib/model';
import { applyCommand } from '../../src/lib/commands';
import { setItemFulfillment } from '../../src/lib/fulfillment-state';
const purchased = '2025-10-01T12:00:00Z',
  soldAt = '2026-01-01T12:00:00Z';
function addItem(
  w: Workspace,
  sku: string,
  cost: number,
  asking: number,
  status: 'Purchased' | 'Returned' | 'Archived' = 'Purchased',
) {
  return applyCommand(w, {
    type: 'item',
    value: itemSchema.parse({
      id: crypto.randomUUID(),
      sku,
      title: `Pipeline ${sku}`,
      cost,
      asking,
      purchasedAt: purchased,
      createdAt: purchased,
      status,
    }),
  });
}
function sale(
  w: Workspace,
  itemIds: string[],
  prices: number[],
  externalId: string,
  patch: Record<string, unknown> = {},
) {
  return applyCommand(w, {
    type: 'order',
    value: orderSchema.parse({
      id: crypto.randomUUID(),
      marketplace: 'Vinted',
      externalId,
      date: soldAt,
      lines: itemIds.map((itemId, i) => ({
        itemId,
        price: prices[i],
        costBasis: w.items.find((it) => it.id === itemId)!.cost,
      })),
      discount: 0,
      shippingCollected: 0,
      fees: 0,
      processing: 0,
      shipping: 0,
      packaging: 0,
      other: 0,
      refund: 0,
      feeCredit: 0,
      adjustment: 0,
      tips: 0,
      type: 'Sale',
      status: 'Completed',
      fulfillment: 'Unfulfilled',
      payout: 'Pending',
      amountsConfirmed: true,
      ...patch,
    }),
  });
}
function fixture() {
  let w = emptyWorkspace();
  w.settings.estimatedSellingExpenses = 500;
  for (const args of [
    ['UNLISTED', 1000, 3000],
    ['NO-ESTIMATE', 500, 0],
    ['LISTED', 1200, 6000],
    ['SOLD', 800, 3000],
    ['DELIVERED', 1500, 5000],
    ['PERSON', 400, 1000],
  ] as const)
    w = addItem(w, args[0], args[1], args[2]);
  const listed = w.items.find((i) => i.sku === 'LISTED')!;
  for (const [marketplace, price] of [
    ['Vinted', 5000],
    ['Depop', 4500],
  ] as const)
    w = applyCommand(w, {
      type: 'listing',
      value: listingSchema.parse({
        id: crypto.randomUUID(),
        itemId: listed.id,
        marketplace,
        price,
        originalPrice: price,
        listedAt: purchased,
        status: 'Active',
      }),
    });
  w = sale(w, [w.items.find((i) => i.sku === 'SOLD')!.id], [3000], 'PIPE-SOLD', {
    fees: 200,
    shipping: 100,
  });
  w = sale(w, [w.items.find((i) => i.sku === 'DELIVERED')!.id], [5000], 'PIPE-DELIVERED', {
    fees: 500,
    shipping: 300,
    fulfillment: 'Delivered',
  });
  w = sale(w, [w.items.find((i) => i.sku === 'PERSON')!.id], [1000], 'PIPE-PERSON', {
    marketplace: 'In person',
  });
  w = applyCommand(w, {
    type: 'order',
    value: setItemFulfillment(
      w.orders[2],
      w.items.find((i) => i.sku === 'PERSON')!.id,
      'Handed over',
      '2026-01-02T12:00:00Z',
    ),
  });
  w = addItem(w, 'RETURNED', 700, 2000, 'Returned');
  w = addItem(w, 'ARCHIVED', 900, 2500, 'Archived');
  return w;
}
async function seed(page: Page, w = fixture()) {
  await page.goto('/demo');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await page.evaluate((w) => localStorage.setItem('thrift-log.demo.v1', JSON.stringify(w)), w);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  return w;
}
const pipeline = (page: Page) =>
  page.getByRole('region', { name: 'Inventory Pipeline', exact: true });
const card = (page: Page, name: string) =>
  pipeline(page).getByRole('link', { name: `View ${name} items`, exact: true });
test('pipeline metrics are instant, unique, session-persistent and independent of report dates', async ({
  page,
}, testInfo) => {
  await seed(page);
  const p = pipeline(page),
    toggle = p.getByRole('group', { name: 'Pipeline metric' });
  await expect(toggle.getByRole('button', { name: 'Sale Value', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card(page, 'Unlisted').locator('.pipeline-count')).toHaveText('2 items');
  await expect(card(page, 'For Sale').locator('.pipeline-count')).toHaveText('1 item');
  await expect(card(page, 'Sold').locator('.pipeline-count')).toHaveText('1 item');
  await expect(card(page, 'Shipped').locator('.pipeline-count')).toHaveText('2 items');
  await expect(card(page, 'Unlisted')).toContainText('$30.00');
  await expect(card(page, 'Unlisted')).toContainText('1 incomplete');
  await expect(card(page, 'For Sale')).toContainText('$45.00');
  await expect(card(page, 'Shipped')).toContainText('$60.00');
  const before = await page.evaluate(() => localStorage.getItem('thrift-log.demo.v1'));
  await toggle.getByRole('button', { name: 'Cost', exact: true }).click();
  for (const [name, value] of [
    ['Unlisted', '$15.00'],
    ['For Sale', '$12.00'],
    ['Sold', '$8.00'],
    ['Shipped', '$19.00'],
  ])
    await expect(card(page, name)).toContainText(value);
  await toggle.getByRole('button', { name: 'Profit', exact: true }).click();
  for (const [name, value] of [
    ['Unlisted', '$15.00'],
    ['For Sale', '$28.00'],
    ['Sold', '$19.00'],
    ['Shipped', '$33.00'],
  ])
    await expect(card(page, name)).toContainText(value);
  await expect(card(page, 'Unlisted')).toContainText('Potential Profit');
  await expect(card(page, 'Sold')).toContainText('Realized Profit');
  await page.getByLabel('Date range', { exact: true }).selectOption('Today');
  await expect(card(page, 'Sold')).toContainText('$19.00');
  expect(await page.evaluate(() => localStorage.getItem('thrift-log.demo.v1'))).toBe(before);
  await page.reload();
  await expect(pipeline(page).getByRole('button', { name: 'Profit', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await p.locator('summary').click();
  await expect(p).toContainText('Depop: 1 listings');
  await expect(p).toContainText('Vinted: 1 listings');
  await expect(p).toContainText('1 returned items await restocking');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await p.screenshot({ path: testInfo.outputPath('pipeline.png'), animations: 'disabled' });
});
test('all stage links preserve current physical filters through reload and ignore old sale dates', async ({
  page,
}) => {
  await seed(page);
  for (const [name, route, rows] of [
    ['Unlisted', 'inventory?pipeline=unlisted', 2],
    ['For Sale', 'inventory?pipeline=for-sale', 1],
    ['Sold', 'inventory?pipeline=sold', 1],
    ['Shipped', 'inventory?pipeline=shipped', 2],
  ] as const) {
    await card(page, name).click();
    await expect(page).toHaveURL(new RegExp('/demo/' + route.replace('?', '\\?') + '$'));
    await expect(page.locator('table tbody tr')).toHaveCount(rows);
    await page.reload();
    await expect(page.locator('table tbody tr')).toHaveCount(rows);
    if (route.startsWith('sales')) {
      await expect(page.getByLabel('Date range', { exact: true })).toHaveCount(0);
      await expect(page.getByText(/As of now · All sale dates/)).toBeVisible();
    }
    await page.getByLabel('Filter inventory status', { exact: true }).selectOption('all');
    await expect(page).not.toHaveURL(/pipeline=/);
    await page.goto('/demo');
    await expect(pipeline(page)).toBeVisible();
  }
});
test('partial shipment and explicit handover update the pipeline without adding expenses or orders', async ({
  page,
}) => {
  let w = addItem(addItem(emptyWorkspace(), 'PART-A', 1000, 3000), 'PART-B', 1200, 4000);
  w = sale(
    w,
    w.items.map((i) => i.id),
    [3000, 4000],
    'PIPE-PARTIAL',
    { fees: 301, shipping: 499 },
  );
  await seed(page, w);
  await expect(card(page, 'Sold').locator('.pipeline-count')).toHaveText('2 items');
  await card(page, 'Sold').click();
  await page.getByRole('button', { name: 'Manage fulfillment' }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Fulfillment for PART-A', exact: true })
    .selectOption('Shipped');
  await expect(
    dialog.getByRole('combobox', { name: 'Fulfillment for PART-A', exact: true }),
  ).toHaveValue('Shipped');
  await expect(page.getByText('Item fulfillment saved.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await page.goto('/demo');
  await expect(card(page, 'Sold').locator('.pipeline-count')).toHaveText('1 item');
  await expect(card(page, 'Shipped').locator('.pipeline-count')).toHaveText('1 item');
  await card(page, 'Sold').click();
  await page.getByRole('button', { name: 'Manage fulfillment' }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Fulfillment for PART-B', exact: true })
    .selectOption('Handed over');
  await expect(
    dialog.getByRole('combobox', { name: 'Fulfillment for PART-B', exact: true }),
  ).toHaveValue('Handed over');
  await expect(page.getByText('Item fulfillment saved.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.goto('/demo');
  await expect(card(page, 'Sold').locator('.pipeline-count')).toHaveText('0 items');
  await expect(card(page, 'Shipped').locator('.pipeline-count')).toHaveText('2 items');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.orders).toHaveLength(1);
  expect(saved.orders[0].fees).toBe(301);
  expect(saved.orders[0].shipping).toBe(499);
  expect(saved.expenses).toHaveLength(0);
  await card(page, 'Shipped').click();
  await expect(page.getByText('Handed over', { exact: true })).toBeVisible();
});
test('new purchases and saved listings automatically enter the correct stages', async ({
  page,
}) => {
  await seed(page, emptyWorkspace());
  await card(page, 'Unlisted').click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Item title').fill('Pipeline new jacket');
  await dialog.getByRole('textbox', { name: /^SKU/ }).fill('PIPE-NEW');
  await dialog.getByRole('spinbutton', { name: /^Purchase cost/ }).fill('12');
  await dialog.getByLabel('Asking price ($)').fill('45');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/demo');
  await expect(card(page, 'Unlisted').locator('.pipeline-count')).toHaveText('1 item');
  await card(page, 'Unlisted').click();
  await page.getByLabel('Filter inventory status', { exact: true }).selectOption('all');
  await page
    .getByRole('button', { name: /^Listings/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Add listing', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Inventory item')
    .selectOption({ label: 'PIPE-NEW · Pipeline new jacket' });
  await dialog.getByLabel('Asking price ($)').fill('45');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/demo');
  await expect(card(page, 'Unlisted').locator('.pipeline-count')).toHaveText('0 items');
  await expect(card(page, 'For Sale').locator('.pipeline-count')).toHaveText('1 item');
});
test('widget visibility and selling estimates are optional settings', async ({ page }) => {
  const w = fixture();
  w.settings.estimatedSellingExpenses = null;
  await seed(page, w);
  await pipeline(page).getByRole('button', { name: 'Profit', exact: true }).click();
  await expect(card(page, 'For Sale').locator('.pipeline-money')).toHaveText('$33.00');
  await expect(card(page, 'For Sale')).toContainText('before selling expenses');
  await expect(card(page, 'For Sale')).not.toContainText('incomplete');
  await page.goto('/demo/settings');
  await page.getByLabel('Estimated selling expenses per item ($)', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Preferences saved.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Inventory Pipeline', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Inventory Pipeline', exact: true }),
  ).not.toBeChecked();
  await page.goto('/demo');
  await expect(pipeline(page)).toHaveCount(0);
  await page.goto('/demo/settings');
  await page.getByRole('checkbox', { name: 'Inventory Pipeline', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Inventory Pipeline', exact: true }),
  ).toBeChecked();
  await page.goto('/demo');
  await expect(pipeline(page)).toBeVisible();
  await expect(card(page, 'For Sale')).toContainText('$28.00');
});

test('marketplace filters find imported sold and shipped pieces without listings and use the actual sale instead of old cross-listings', async ({
  page,
}) => {
  let w = emptyWorkspace();
  for (const sku of [
    'DEPOP-SHIPPED',
    'DEPOP-DELIVERED',
    'DEPOP-SOLD',
    'VINTED-SHIPPED',
    'CROSS-LISTED',
    'UNASSIGNED',
  ])
    w = addItem(w, sku, 500, 2500);
  for (const marketplace of ['Depop', 'Vinted'] as const) {
    for (const sku of ['CROSS-LISTED', 'VINTED-SHIPPED']) {
      w = applyCommand(w, {
        type: 'listing',
        value: listingSchema.parse({
          id: crypto.randomUUID(),
          itemId: w.items.find((i) => i.sku === sku)!.id,
          marketplace,
          price: 2500,
          originalPrice: 2500,
          listedAt: purchased,
          status: 'Active',
        }),
      });
    }
  }
  for (const [sku, marketplace, fulfillment] of [
    ['DEPOP-SHIPPED', 'Depop', 'Shipped'],
    ['DEPOP-DELIVERED', 'Depop', 'Delivered'],
    ['DEPOP-SOLD', 'Depop', 'Unfulfilled'],
    ['VINTED-SHIPPED', 'Vinted', 'Shipped'],
  ] as const)
    w = sale(w, [w.items.find((i) => i.sku === sku)!.id], [2500], sku, {
      marketplace,
      fulfillment,
    });
  expect(
    w.listings.some((l) => w.items.find((i) => i.id === l.itemId)!.sku.startsWith('DEPOP-')),
  ).toBe(false);
  await seed(page, w);
  await card(page, 'Shipped').click();
  const rows = page.locator('table tbody tr');
  const market = page.getByRole('combobox', { name: 'Filter marketplace', exact: true });
  const stage = page.getByRole('combobox', { name: 'Filter inventory status', exact: true });
  await expect(rows).toHaveCount(3);
  await market.selectOption('Depop');
  await expect(rows).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Select all matching (2)', exact: true }),
  ).toBeVisible();
  await expect(rows.filter({ hasText: 'DEPOP-SHIPPED' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'DEPOP-DELIVERED' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'VINTED-SHIPPED' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select all matching (2)', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Select DEPOP-SHIPPED', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Select DEPOP-DELIVERED', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await market.selectOption('Vinted');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('VINTED-SHIPPED');
  await market.selectOption('Depop');
  await stage.selectOption('sold');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('DEPOP-SOLD');
  await stage.selectOption('for-sale');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('CROSS-LISTED');
  await market.selectOption('Vinted');
  await expect(rows).toHaveCount(1);
  await market.selectOption('All marketplaces');
  await expect(rows).toHaveCount(1);
  await stage.selectOption('unlisted');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('UNASSIGNED');
  await stage.selectOption('shipped');
  await expect(page).toHaveURL(/pipeline=shipped/);
  await expect(rows).toHaveCount(3);
  await page.reload();
  await market.selectOption('Depop');
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.orders).toEqual(w.orders);
  expect(saved.items).toEqual(w.items);
  expect(saved.listings).toEqual(w.listings);
});
