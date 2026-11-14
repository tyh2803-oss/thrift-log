import { test, expect } from '@playwright/test';
import { navigationWorkspace } from '../helpers/navigation-workspace';

test('600 imported sales keep tab rendering bounded on a throttled device', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120000);
  const w = await navigationWorkspace();
  await page.goto('/demo');
  await page.evaluate((w) => localStorage.setItem('thrift-log.demo.v1', JSON.stringify(w)), w);
  await page.goto('/demo/sales');
  await expect(page.getByRole('button', { name: 'Record sale', exact: true })).toBeVisible();
  const client = await page.context().newCDPSession(page);
  if (browserName === 'chromium') await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    document.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element).closest('a');
        if (a && ['Inventory', 'Sales'].includes(a.textContent?.trim() || ''))
          performance.mark('tab-input');
      },
      true,
    );
  });
  // Install in the current document as well (init scripts cover later full reloads).
  await page.evaluate(() =>
    document.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element).closest('a');
        if (a && /^(Inventory|Sales)(\s*\d+)?$/.test(a.textContent?.trim() || ''))
          performance.mark('tab-input');
      },
      true,
    ),
  );
  await page.evaluate(() => {
    const stats = { parses: 0, bytes: 0 };
    (window as unknown as { navStats: typeof stats }).navStats = stats;
    const parse = JSON.parse;
    JSON.parse = (text, reviver) => {
      stats.parses++;
      stats.bytes += String(text).length;
      return parse(text, reviver);
    };
  });
  const timings: number[] = [];
  for (const [name, title] of [
    ['Inventory', 'Every piece, in its place.'],
    ['Sales', 'Good finds. Great sales.'],
    ['Inventory', 'Every piece, in its place.'],
  ] as const) {
    const link = page
      .getByRole('link', { name: new RegExp(`^${name}(?: \\d+)?$`) })
      .filter({ visible: true })
      .last();
    await page.evaluate(() => {
      const s = (window as unknown as { navStats: { parses: number; bytes: number } }).navStats;
      s.parses = 0;
      s.bytes = 0;
    });
    await link.click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(
                performance.now() - performance.getEntriesByName('tab-input').at(-1)!.startTime,
              ),
            ),
          ),
        ),
    );
    timings.push(ms);
    console.log(
      name,
      Math.round(ms),
      'ms input to paint',
      await page.evaluate(
        () => (window as unknown as { navStats: { parses: number; bytes: number } }).navStats,
      ),
    );
    expect(
      (await page.evaluate(() => (window as unknown as { navStats: { parses: number } }).navStats))
        .parses,
    ).toBeLessThan(5000);
    await expect(page.locator('.view-surface .table-wrap tbody tr')).toHaveCount(50);
    await expect(page).toHaveURL(new RegExp(`/demo/${name.toLowerCase()}$`));
  }
  console.log('600-order 4x-CPU tab input→paint (ms):', timings.map(Math.round));
  expect(Math.max(...timings)).toBeLessThan(1000);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).orders.length,
    ),
  ).toBe(600);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('progressive rows preserve full search, export, bulk selection, listing access and saved records', async ({
  page,
}) => {
  const { readFile } = await import('node:fs/promises');
  const { listingSchema } = await import('../../src/lib/model');
  const { readCsv } = await import('../../src/lib/csv');
  const w = await navigationWorkspace(123);
  w.listings = w.items.map((i) =>
    listingSchema.parse({
      id: crypto.randomUUID(),
      itemId: i.id,
      marketplace: 'Depop',
      price: 3500,
      originalPrice: 3500,
      listedAt: w.orders[0].date,
      status: 'Sold',
    }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  await page.evaluate((w) => localStorage.setItem('thrift-log.demo.v1', JSON.stringify(w)), w);
  await page.goto('/demo/inventory');
  const rows = page.locator('.view-surface .table-wrap tbody tr');
  await expect(rows).toHaveCount(50);
  await expect(page.getByRole('group', { name: 'More inventory items' })).toContainText(
    'Showing 50 of 123',
  );
  await page.getByRole('button', { name: 'Select all matching (123)', exact: true }).click();
  await expect(page.locator('.pipeline-bulk-bar strong')).toHaveText('123 selected');
  await page.getByRole('button', { name: 'Show 50 more inventory items', exact: true }).click();
  await expect(rows).toHaveCount(100);
  await expect(page.getByRole('checkbox', { name: 'Select PERF-75', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Show 23 more inventory items', exact: true }).click();
  await expect(rows).toHaveCount(123);
  await page.getByRole('button', { name: 'Move selected (123)', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Change pipeline status', exact: true });
  await expect(move).toContainText('123 physical items selected');
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search your business', exact: true });
  await search.fill('Navigation item 119');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Navigation item 119');
  await expect(page.locator('.pipeline-bulk-bar strong')).toHaveText('123 selected');
  await search.fill('');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect(readCsv(await readFile((await (await download).path())!, 'utf8')).rows).toHaveLength(123);
  await page.getByRole('button', { name: /^Listings \d+/ }).click();
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: 'Show 50 more listings', exact: true }).click();
  await expect(rows).toHaveCount(100);
  await search.fill('PERF-119');
  await expect(rows).toHaveCount(1);
  await search.fill('');
  await page
    .getByRole('link', { name: 'Sales', exact: true })
    .filter({ visible: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/demo\/sales$/);
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: 'Show 50 more orders', exact: true }).click();
  await expect(rows).toHaveCount(100);
  await search.fill('Navigation item 119');
  await expect(rows).toHaveCount(1);
  await search.fill('');
  await page.getByRole('button', { name: 'Bulk purchase costs', exact: true }).click();
  const costs = page.getByRole('dialog', { name: 'Bulk purchase costs', exact: true });
  await expect(costs).toContainText('123 matching physical items');
  await costs.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!)),
  ).toEqual(w);
  await page.reload();
  await expect(rows).toHaveCount(50);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
