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
