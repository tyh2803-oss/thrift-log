import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { extractedSale, extractedLine } from '../helpers/assistant';
const owner = '11111111-1111-4111-8111-111111111111';
const friend = '22222222-2222-4222-8222-222222222222';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
test.beforeEach(async ({ request, page }) => {
  expect((await request.post(`${authOrigin}/__reset`)).ok()).toBe(true);
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
});
test('informal spreadsheet imports use batch date and fee entry, preserve costs and summaries, and persist isolated sales after reload', async ({
  page,
  request,
  context,
}) => {
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Import files').setInputFiles({
    name: 'personal-spreadsheet.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Untitled spreadsheet - Sheet1\n2026,,,,,,,\nItem,Purchased Price,Sold Price,,Total Spent,Total Made,,Profit\nCoat,$1.00,$25.00,,$999.00,$9999.00,,$9000.00\nBoots,$0.00,$30.00,,,,,\nHat,,$10.00,,,,,\nShirt,$2.50,$12.50,,,,,',
    ),
  });
  await dialog.locator('textarea').fill('These were sold on Depop');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
  expect((await (await request.get(`${authOrigin}/__metrics`)).json()).businessWrites).toBe(0);
  await dialog.getByLabel('Sale date · 4 missing', { exact: true }).fill('2026-11-12');
  await dialog.getByRole('button', { name: 'Fill missing dates', exact: true }).click();
  const fees = dialog.getByLabel('Total seller fees per sale ($) · 4 missing', { exact: true });
  await fees.fill('bad-fee');
  await expect(
    dialog.getByRole('button', { name: 'Fill missing fees', exact: true }),
  ).toBeDisabled();
  await fees.fill('0');
  await dialog.getByRole('button', { name: 'Fill missing fees', exact: true }).click();
  const approve = dialog.getByRole('button', { name: 'Approve All Ready (4)', exact: true });
  await expect(approve).toBeEnabled();
  await expect(dialog.getByLabel('Purchase cost 1-1', { exact: true })).toHaveValue('1');
  await expect(dialog.getByLabel('Purchase cost 2-1', { exact: true })).toHaveValue('0');
  await expect(dialog.getByLabel('Purchase cost 3-1', { exact: true })).toHaveValue('');
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await approve.click();
  await expect(dialog.getByText(/Saved 4 approved sale-history records/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  const response = await context.request.get('/api/workspace', {
    headers: { 'x-thrift-user': owner },
  });
  const saved = await response.json();
  expect(saved.items).toHaveLength(before.workspaces[owner].items.length + 4);
  for (const item of before.workspaces[owner].items)
    expect(saved.items.find((candidate: { id: string }) => candidate.id === item.id)).toMatchObject(
      item,
    );
  expect(saved.orders).toHaveLength(4);
  expect(
    saved.orders.every(
      (o: { marketplace: string; fees: number; date: string }) =>
        o.marketplace === 'Depop' && o.fees === 0 && o.date.startsWith('2026-11-12'),
    ),
  ).toBe(true);
  expect(
    saved.orders
      .map((o: { lines: { price: number; costBasis: number }[] }) => o.lines[0])
      .map((l: { price: number; costBasis: number }) => [l.price, l.costBasis]),
  ).toEqual([
    [2500, 100],
    [3000, 0],
    [1000, 0],
    [1250, 250],
  ]);
  const receipts = saved.imports
    .filter((r: { mapping: { history?: string } }) => r.mapping.history === 'true')
    .map((r: { rawCsv: string }) => JSON.parse(r.rawCsv));
  expect(
    receipts.flatMap((r: { unknownCostItemIds: string[] }) => r.unknownCostItemIds),
  ).toHaveLength(1);
  expect(receipts.flatMap((r: { knownZeroItemIds: string[] }) => r.knownZeroItemIds)).toHaveLength(
    1,
  );
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.businessWrites).toBe(1);
  expect(after.workspaces[friend]).toEqual(before.workspaces[friend]);
});
test('a 133-item personal spreadsheet can be corrected and approved in one isolated transaction', async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(60000);
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Import files').setInputFiles({
    name: 'large-personal.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Personal spreadsheet\n2026,,,,,,,\nItem,Purchased Price,Sold Price,,Total Spent,Total Made,,Profit\n' +
        Array.from(
          { length: 133 },
          (_, i) =>
            `Garment ${i},$1.00,${i === 1 ? '' : '$25.00'},,${i === 0 ? '$9999.00' : ''},,,`,
        ).join('\n'),
    ),
  });
  await dialog.locator('textarea').fill('These sold on Depop on 2026-11-12');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog
    .getByLabel('Total seller fees per sale ($) · 133 missing', { exact: true })
    .fill('1.25');
  await dialog.getByRole('button', { name: 'Fill missing fees', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (132)', exact: true }),
  ).toBeEnabled();
  await dialog.getByLabel('Sale price 2-1', { exact: true }).fill('25');
  const approve = dialog.getByRole('button', { name: 'Approve All Ready (133)', exact: true });
  await expect(approve).toBeEnabled();
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await approve.click();
  await expect(dialog.getByText(/Saved 133 approved sale-history records/)).toBeVisible({
    timeout: 20000,
  });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  const saved = await (
    await context.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
  ).json();
  expect(saved.items).toHaveLength(before.workspaces[owner].items.length + 133);
  expect(saved.orders).toHaveLength(133);
  expect(
    new Set(
      saved.orders.flatMap((o: { lines: { itemId: string }[] }) => o.lines.map((l) => l.itemId)),
    ).size,
  ).toBe(133);
  expect(saved.orders.reduce((sum: number, o: { fees: number }) => sum + o.fees, 0)).toBe(16625);
  expect(
    saved.orders
      .flatMap((o: { lines: { costBasis: number; price: number }[] }) => o.lines)
      .every((l: { costBasis: number; price: number }) => l.costBasis === 100 && l.price === 2500),
  ).toBe(true);
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.businessWrites).toBe(1);
  expect(after.workspaces[friend]).toEqual(before.workspaces[friend]);
});
test('authenticated assistant receives the native Depop CSV and saves 40 isolated sales through the real approval route, preserving all existing account data', async ({
  page,
  request,
  context,
}) => {
  const before = await (await request.get(`${authOrigin}/__metrics`)).json();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Import files').setInputFiles({
    name: 'depop.csv',
    mimeType: 'text/csv',
    buffer: await readFile(new URL('../fixtures/csv/depop-synthetic.csv', import.meta.url)),
  });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const approve = dialog.getByRole('button', { name: 'Approve All Ready (40)', exact: true });
  await expect(approve).toBeEnabled({ timeout: 20000 });
  await approve.click();
  await expect(dialog.getByText(/Saved 40 approved sale-history records/)).toBeVisible({
    timeout: 20000,
  });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  const response = await context.request.get('/api/workspace', {
    headers: { 'x-thrift-user': owner },
  });
  expect(response.ok()).toBe(true);
  const workspace = await response.json();
  expect(workspace.items).toHaveLength(45);
  expect(workspace.orders).toHaveLength(40);
  expect(workspace.items.find((i: { sku: string }) => i.sku === 'RETAINED-1').cost).toBe(1200);
  expect(JSON.stringify(workspace)).not.toMatch(/PRIVATE_BUYER|PRIVATE_ADDRESS|PRIVATE_PERSON/);
  const denied = await context.request.get('/api/workspace', {
    headers: { 'x-thrift-user': friend },
  });
  expect(denied.status()).toBe(401);
  const after = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(after.businessWrites).toBe(1);
  expect(after.workspaces[friend]).toEqual(before.workspaces[friend]);
  expect(
    after.workspaces[owner].orders.filter((o: { lines: unknown[] }) => o.lines.length === 5),
  ).toHaveLength(1);
});
test('PDF response adapter keeps per-file review and optional costs, approves through the real server route, and persists across reload', async ({
  page,
  context,
  request,
}) => {
  let pdfBody = false;
  await page.route('**/api/assistant/extract', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { enabled: true, batchLimit: 10 } });
    pdfBody = !!route.request().postDataBuffer()?.includes(Buffer.from('%PDF-1.4'));
    return route.fulfill({
      json: {
        screenshots: [
          {
            hash: 'a'.repeat(64),
            sourceType: 'pdf',
            name: 'report.pdf',
            extraction: {
              message: 'Synthetic provider extraction for a PDF invoice.',
              records: [
                extractedSale({
                  externalOrderId: 'PDF-SALE-1',
                  currency: null,
                  lines: [
                    extractedLine({ title: 'UniqueInvoiceCoat', sku: null, purchaseCost: null }),
                  ],
                }),
              ],
            },
          },
        ],
      },
    });
  });
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Import files').setInputFiles({
    name: 'report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole('button', {
      name: 'Confirm unidentified amounts are USD (no conversion)',
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeEnabled();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: `/tmp/thrift-history-review-${page.viewportSize()!.width}.png`,
  });
  await expect(dialog.getByLabel('Purchase cost 1-1', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await expect(dialog.getByText(/Saved 1 approved sale-history records/)).toBeVisible();
  expect(pdfBody).toBe(true);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  const workspace = await (
    await context.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
  ).json();
  expect(workspace.orders).toHaveLength(1);
  expect(workspace.orders[0].externalId).toBe('PDF-SALE-1');
  expect(JSON.parse(workspace.imports[0].rawCsv).unknownCostItemIds).toHaveLength(1);
  const metrics = await (await request.get(`${authOrigin}/__metrics`)).json();
  expect(metrics.businessWrites).toBe(1);
  expect(metrics.unexpectedWrites).toBe(0);
});
