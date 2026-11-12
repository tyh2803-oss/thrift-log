import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyWorkspace, type Workspace } from '../../src/lib/model';
const key = 'thrift-log.demo.v1';
async function seed(page: Page, w: Workspace = emptyWorkspace()) {
  await page.goto('/demo');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await page.evaluate(({ w, key }) => localStorage.setItem(key, JSON.stringify(w)), { w, key });
  await page.goto('/demo/inventory');
  await page.reload();
}
async function importFile(page: Page, text: string) {
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'sales.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  return dialog;
}
test('four columns import without order IDs or SKUs; optional decimal cost, unknown cost and confirmed zero remain distinct after reload', async ({
  page,
}) => {
  await seed(page);
  const dialog = await importFile(
    page,
    'Item Name,Price,Date,Fees\nUniqueCoat,25,2026-11-10,1\nUniqueBoots,30,2026-11-11,2',
  );
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Get CSV template', exact: true }).click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, 'utf8')).toBe(
    'item_name,price,date,fees,purchase_cost\r\n,,,,',
  );
  await dialog.getByLabel('CSV marketplace').selectOption('Depop');
  await dialog.getByRole('button', { name: 'Review sales', exact: true }).click();
  const review = dialog.getByRole('region', { name: 'Sale history review' });
  await expect(
    review.getByRole('button', { name: 'Approve All Ready (2)', exact: true }),
  ).toBeEnabled();
  const cost = review.getByLabel('Purchase cost 1-1', { exact: true });
  await cost.pressSequentially('6.25');
  await expect(cost).toHaveValue('6.25');
  await review.getByRole('button', { name: 'Approve All Ready (2)', exact: true }).click();
  await expect(dialog.getByText('Imported 2 sale records.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.items).toHaveLength(2);
  expect(saved.orders).toHaveLength(2);
  expect(saved.orders.map((o: { lines: { costBasis: number }[] }) => o.lines[0].costBasis)).toEqual(
    [625, 0],
  );
  expect(
    saved.imports.flatMap((r: { rawCsv: string }) => JSON.parse(r.rawCsv).unknownCostItemIds),
  ).toHaveLength(1);
  await page.goto('/demo');
  await page.getByLabel('Date range', { exact: true }).selectOption('All time');
  await expect(page.locator('.dashboard-metrics .metric[data-metric="revenue"]')).toContainText(
    '$55.00',
  );
  await expect(
    page.locator('.dashboard-metrics .metric[data-metric="profit"]').first(),
  ).toContainText('—');
  await expect(page.locator('.dashboard-metrics')).toContainText('purchase costs unknown');
  await page.goto('/demo/insights');
  await page.getByLabel('Date range', { exact: true }).selectOption('All time');
  await expect(
    page.getByText(/Profit, margin, ROI and profit charts are incomplete/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finances', exact: true }).click();
  await expect(
    page.getByText('Historical items with unknown purchase dates are excluded.', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
test('native 44-item Depop report preserves the five-item bundle, needs no extra columns, and allows a deliberate new import of all 40 sales', async ({
  page,
}) => {
  await seed(page);
  const text = await readFile(
    new URL('../fixtures/csv/depop-synthetic.csv', import.meta.url),
    'utf8',
  );
  const dialog = await importFile(page, text);
  await expect(dialog.getByLabel('CSV marketplace')).toHaveValue('Depop');
  await expect(dialog.getByText(/Depop sales report detected/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Review sales', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (40)', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Approve All Ready (40)', exact: true }).click();
  await expect(dialog.getByText('Imported 40 sale records.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Review sales', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (40)', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Approve All Ready (40)', exact: true }).click();
  await expect(dialog.getByText('Imported 40 sale records.', { exact: true })).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.items).toHaveLength(88);
  expect(saved.orders).toHaveLength(80);
  expect(saved.orders.filter((o: { lines: unknown[] }) => o.lines.length === 5)).toHaveLength(2);
  expect(JSON.stringify(saved)).not.toMatch(/PRIVATE_BUYER|PRIVATE_ADDRESS|PRIVATE_PERSON/);
});
test('marketplace/date mapping and explicit zero costs work, and malformed monetary input cannot save old values', async ({
  page,
}) => {
  await seed(page);
  const dialog = await importFile(
    page,
    'Name,Price,Date,Fees,Purchase Cost\nGenuineCoat,25,01/02/2026,0,0',
  );
  await dialog.getByLabel('CSV marketplace').selectOption('eBay');
  await dialog.getByRole('button', { name: 'Review sales', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('ambiguous');
  await dialog.getByLabel('CSV date format').selectOption('mdy');
  await dialog.getByRole('button', { name: 'Review sales', exact: true }).click();
  const cost = dialog.getByLabel('Purchase cost 1-1', { exact: true });
  await cost.fill('not-a-cost');
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
  await cost.fill('0');
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await expect(dialog.getByText('Imported 1 sale records.', { exact: true })).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.orders[0].marketplace).toBe('eBay');
  expect(saved.orders[0].date).toMatch(/^2026-01-02/);
  expect(JSON.parse(saved.imports[0].rawCsv).unknownCostItemIds).toEqual([]);
  expect(JSON.parse(saved.imports[0].rawCsv).knownZeroItemIds).toHaveLength(1);
});
test('assistant accepts PDF/CSV attachments as file cards on mobile while demo cannot spend private AI credits', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Import files').setInputFiles([
    { name: 'history.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') },
    {
      name: 'history.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name,Price,Date,Fees\nExample,25,2026-11-10,0'),
    },
  ]);
  await expect(dialog.getByRole('button', { name: 'Remove history.pdf' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove history.csv' })).toBeVisible();
  await expect(dialog.locator('.assistant-document')).toHaveCount(2);
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Sign in');
  await dialog.getByRole('button', { name: 'Remove history.pdf' }).click();
  await expect(dialog.locator('.assistant-document')).toHaveCount(1);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('optional packaging and show mappings persist while unknown costs cannot inflate show earnings', async ({
  page,
}) => {
  const w = emptyWorkspace();
  const showId = '55555555-5555-4555-8555-555555555555';
  w.shows.push({
    id: showId,
    name: 'Retained sale history show',
    date: '2026-11-10T12:00:00Z',
    type: 'Whatnot',
    status: 'Ended',
    notes: '',
    externalId: '',
    checklist: [],
    lineup: [],
    durationMinutes: 60,
  });
  await seed(page, w);
  const dialog = await importFile(
    page,
    `Name,Price,Date,Fees,Packaging,Show ID\nUniqueShowCoat,25,2026-11-10,1,0.75,${showId}`,
  );
  await dialog.getByLabel('CSV marketplace').selectOption('Whatnot');
  await dialog.getByRole('button', { name: 'Review sales', exact: true }).click();
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await expect(dialog.getByText('Imported 1 sale records.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.goto('/demo/sales');
  await page.getByRole('button', { name: 'Shows & events', exact: true }).click();
  const show = page.locator('.show-preview').filter({ hasText: 'Retained sale history show' });
  await expect(show).toContainText('Profit incomplete');
  await show.click();
  await expect(
    page.getByRole('dialog').locator('.metric').filter({ hasText: 'Realized profit' }),
  ).toContainText('—');
  await expect(
    page.getByRole('dialog').locator('.metric').filter({ hasText: 'Livestream earnings' }),
  ).toContainText('—');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.orders[0]).toMatchObject({ packaging: 75, showId });
});

test('matching Patagonia descriptions import every row without duplicate menus or confirmation checkboxes, with required-field readiness intact', async ({
  page,
}) => {
  await seed(page);
  const csv =
    'Name,Price,Date,Fees\n' +
    Array(5)
      .fill('Blue Patagonia quarter zip pullover. Great Condition,25,2026-11-10,1.32')
      .join('\n');
  const dialog = await importFile(page, csv);
  await dialog.getByLabel('CSV marketplace').selectOption('Depop');
  await dialog.getByRole('button', { name: 'Review sales', exact: true }).click();
  const approve = dialog.getByRole('button', { name: 'Approve All Ready (5)', exact: true });
  await expect(approve).toBeEnabled();
  await expect(dialog.getByText('Possible existing item', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByLabel('Inventory match 1-1')).toHaveValue('new');
  await dialog.locator('.history-item').first().locator('details > summary').click();
  const purchaseDate = dialog
    .getByLabel('Actual purchase date (optional)', { exact: true })
    .first();
  await purchaseDate.fill('2026-10-01');
  await purchaseDate.fill('');
  await expect(approve).toBeEnabled();
  await dialog.getByLabel('Item name 1-1', { exact: true }).fill('');
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (4)', exact: true }),
  ).toBeEnabled();
  await dialog
    .getByLabel('Item name 1-1', { exact: true })
    .fill('Blue Patagonia quarter zip pullover. Great Condition');
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(dialog.getByText('Imported 5 sale records.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.items).toHaveLength(5);
  expect(saved.orders).toHaveLength(5);
  expect(
    new Set(
      saved.orders.flatMap((o: { lines: { itemId: string }[] }) => o.lines.map((l) => l.itemId)),
    ).size,
  ).toBe(5);
});
