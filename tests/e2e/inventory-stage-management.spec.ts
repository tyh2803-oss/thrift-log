import { test, expect, type Page } from '@playwright/test';
import { assistantWorkspace } from '../helpers/assistant';
import type { Workspace } from '../../src/lib/model';
const key = 'thrift-log.demo.v1';
async function seed(page: Page, w: Workspace, path = '/demo') {
  await page.goto('/demo');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await page.evaluate(({ w, key }) => localStorage.setItem(key, JSON.stringify(w)), { w, key });
  await page.goto(path);
  await page.reload();
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
}
const stage = (page: Page, label: string) =>
  page.getByRole('link', { name: `View ${label} items`, exact: true });
async function openStage(page: Page, label: string) {
  await page.goto('/demo');
  await stage(page, label).click();
}
test('individual stage controls record actual sale, ship, undo shipping and undo accidental sale without losing history', async ({
  page,
}) => {
  const w = assistantWorkspace();
  await seed(page, w);
  await stage(page, 'For Sale').click();
  await page.getByRole('button', { name: 'Change status', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Move to stage')).toHaveValue('sold');
  await expect(dialog.getByLabel('Actual sale price ($) · JACKET-1', { exact: true })).toHaveValue(
    '',
  );
  await dialog.getByLabel('Marketplace · JACKET-1', { exact: true }).selectOption('Vinted');
  await dialog.getByLabel('Actual sale price ($) · JACKET-1', { exact: true }).fill('45');
  await dialog
    .getByRole('button', { name: 'Confirm blank sale expenses are $0', exact: true })
    .click();
  await dialog.getByLabel('Marketplace fees ($) · JACKET-1', { exact: true }).fill('4');
  await dialog.getByLabel('Seller shipping ($) · JACKET-1', { exact: true }).fill('3');
  await dialog
    .getByRole('button', { name: 'Save status changes', exact: true })
    .evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await openStage(page, 'Sold');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).orders[0].lines[0].price,
      key,
    ),
  ).toBe(4500);
  await page.getByRole('button', { name: 'Change status', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Move to stage')).toHaveValue('shipped');
  await dialog.getByRole('button', { name: 'Save status changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await openStage(page, 'Shipped');
  await page.getByRole('button', { name: 'Change status', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Move to stage')).toHaveValue('sold');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Save status changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await openStage(page, 'Sold');
  await page.getByRole('button', { name: 'Change status', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Move to stage').selectOption('unlisted');
  await expect(dialog.getByText(/net recognized revenue decreases by/)).toContainText('$45.00');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Save status changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await openStage(page, 'Unlisted');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.orders).toHaveLength(1);
  expect(saved.financialEvents).toHaveLength(3);
  expect(saved.orders[0].lines[0].price).toBe(4500);
  expect(saved.orders[0].fulfillment).toBe('Unfulfilled');
  await page.goto('/demo');
  await expect(page.locator('.metric').filter({ hasText: 'Total revenue' })).toContainText('$0.00');
  await expect(page.locator('.metric').filter({ hasText: 'Net operating profit' })).toContainText(
    '$0.00',
  );
});
test('bulk sale review commits valid items and retains failed selections for correction and retry', async ({
  page,
}) => {
  const w = assistantWorkspace();
  w.items.push({
    ...w.items[0],
    id: crypto.randomUUID(),
    sku: 'SECOND',
    title: 'Second find',
    cost: 500,
    status: 'Ready to List',
  });
  await seed(page, w, '/demo/inventory');
  await page.getByRole('button', { name: 'Select all matching (2)', exact: true }).click();
  await page.getByLabel('Bulk destination').selectOption('sold');
  await page.getByRole('button', { name: 'Move selected (2)', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('2 physical items selected')).toBeVisible();
  await dialog.getByLabel('Shared marketplace').selectOption('Vinted');
  await dialog.getByRole('button', { name: 'Apply marketplace to rows', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Confirm blank sale expenses are $0', exact: true })
    .click();
  await dialog.getByLabel('Actual sale price ($) · JACKET-1', { exact: true }).fill('45');
  await dialog.getByRole('button', { name: 'Save status changes', exact: true }).click();
  await expect(dialog.getByText(/1 items failed; their selection is retained/)).toBeVisible();
  await expect(dialog.getByText('1 physical items selected', { exact: true })).toBeVisible();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).orders.length, key),
  ).toBe(1);
  await dialog.getByLabel('Actual sale price ($) · SECOND', { exact: true }).fill('17.50');
  await dialog.getByRole('button', { name: 'Save status changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).orders.length, key),
  ).toBe(2);
  await openStage(page, 'Sold');
  await page.getByRole('button', { name: 'Select all matching (2)', exact: true }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
});
test('grid selection is separate from item opening and status controls remain usable on narrow screens', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await seed(page, assistantWorkspace(), '/demo/inventory?pipeline=for-sale');
  const selectionTarget = await page.locator('.inventory-check').first().boundingBox();
  expect(selectionTarget!.width).toBeGreaterThanOrEqual(44);
  expect(selectionTarget!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page
    .locator('.inventory-list-card')
    .screenshot({ path: testInfo.outputPath('inventory-list.png') });
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await page.getByLabel('Select JACKET-1', { exact: true }).check();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  const control = page.getByRole('button', { name: 'Change status', exact: true });
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page
    .locator('.inventory-list-card')
    .screenshot({ path: testInfo.outputPath('inventory-grid.png') });
  await control.click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Change pipeline status' }),
  ).toBeVisible();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('pipeline-move.png') });
});

test('five-stage filter removes the banner; filtered bulk archive and restore keep other items unchanged', async ({
  page,
}) => {
  const w = assistantWorkspace();
  w.items.push({
    ...w.items[0],
    id: crypto.randomUUID(),
    sku: 'SECOND',
    title: 'Another find',
    status: 'Purchased',
  });
  await seed(page, w, '/demo/inventory?pipeline=for-sale');
  await expect(page.getByText('For Sale · Current physical inventory')).toHaveCount(0);
  const filter = page.getByLabel('Filter inventory status', { exact: true });
  expect(await filter.locator('option').allTextContents()).toEqual([
    'All stages',
    'Unlisted',
    'For Sale',
    'Sold',
    'Shipped',
    'Archived',
  ]);
  await expect(filter).toHaveValue('for-sale');
  await page.getByRole('button', { name: 'Select all matching (1)', exact: true }).click();
  await page.getByLabel('Bulk destination').selectOption('archived');
  await page.getByRole('button', { name: 'Move selected (1)', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Save status changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await filter.selectOption('archived');
  await expect(page).toHaveURL(/pipeline=archived/);
  await page.reload();
  await expect(filter).toHaveValue('archived');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select all matching (1)', exact: true }).click();
  await page.getByLabel('Bulk destination').selectOption('unlisted');
  await page.getByRole('button', { name: 'Move selected (1)', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Save status changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await filter.selectOption('unlisted');
  await expect(page).toHaveURL(/pipeline=unlisted/);
  await page.reload();
  await expect(page.locator('table tbody tr')).toHaveCount(2);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.items.find((i: { sku: string }) => i.sku === 'SECOND').status).toBe('Purchased');
  expect(saved.items).toHaveLength(2);
  expect(saved.orders).toHaveLength(0);
  expect(saved.listings.every((l: { status: string }) => l.status === 'Ended')).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
test('filter selection survives choosing a bulk destination and five known costs show gross profit', async ({
  page,
}) => {
  const w = assistantWorkspace();
  for (let i = 1; i < 5; i++) {
    const item = { ...w.items[0], id: crypto.randomUUID(), sku: `ITEM-${i}` };
    w.items.push(item);
    w.listings.push({
      ...w.listings[0],
      id: crypto.randomUUID(),
      itemId: item.id,
      externalId: `listing-${i + 1}`,
    });
  }
  w.items.forEach((item) => {
    item.cost = 340;
  });
  w.listings = w.items.map((item, i) => ({
    ...w.listings[0],
    id: crypto.randomUUID(),
    itemId: item.id,
    price: i === 0 ? 2319 : 2500,
    externalId: `LIST-${i}`,
  }));
  await seed(page, w);
  const pipeline = page.getByRole('region', { name: 'Inventory Pipeline', exact: true });
  await pipeline.getByRole('button', { name: 'Profit', exact: true }).click();
  await expect(stage(page, 'For Sale')).toContainText('$106.19');
  await expect(stage(page, 'For Sale')).toContainText('before selling expenses');
  await expect(stage(page, 'For Sale')).not.toContainText('incomplete');
  await stage(page, 'For Sale').click();
  await page.getByLabel('Select JACKET-1', { exact: true }).check();
  await page.getByLabel('Filter inventory status').selectOption('unlisted');
  await page.getByLabel('Bulk destination').selectOption('shipped');
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.getByLabel('Filter inventory status').selectOption('for-sale');
  await expect(page.getByLabel('Select JACKET-1', { exact: true })).toBeChecked();
});
