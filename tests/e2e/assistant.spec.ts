import { test, expect } from '@playwright/test';
const image = {
  name: 'sale.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  ),
};
test('assistant attachments, private analysis boundary, and responsive chat', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Your Thrift Log assistant' })).toBeVisible();
  await dialog.getByLabel('Screenshot files').setInputFiles(image);
  await expect(dialog.getByRole('button', { name: 'Remove sale.jpg' })).toBeVisible();
  await dialog.getByLabel('Message assistant').fill('Log this sale.');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Sign in');
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove sale.jpg' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove sale.jpg' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove sale.jpg' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Clear chat' }).click();
});

import { assistantWorkspace, extractedLine, extractedSale } from '../helpers/assistant';
import { createBatch } from '../../src/lib/assistant/drafts';
test('assistant draft corrections, conflict recovery, approval, and reload without duplicate sales', async ({
  page,
}) => {
  const w = assistantWorkspace();
  const batch = createBatch(
    [
      {
        hash: 'a'.repeat(64),
        name: 'sale.png',
        extraction: {
          records: [extractedSale({ lines: [extractedLine({ listingId: 'listing-1' })] })],
          message: '',
        },
      },
    ],
    w,
  );
  await page.goto('/demo');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await page.evaluate(
    ({ w, batch }) => {
      localStorage.setItem('thrift-log.demo.v1', JSON.stringify(w));
      sessionStorage.setItem('thrift-log.draft.assistant.demo', JSON.stringify(batch));
    },
    { w, batch },
  );
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Net profit: $26.00', { exact: true })).toBeVisible();
  await dialog.getByLabel('Message assistant').fill('The first item sold for $35.');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByText('Net profit: $16.00', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).orders.length,
    ),
  ).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await expect(dialog.getByText('Net profit: $16.00', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const key = 'thrift-log.demo.v1';
    const w = JSON.parse(localStorage.getItem(key)!);
    w.revision++;
    localStorage.setItem(key, JSON.stringify(w));
  });
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('workspace changed');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).orders.length,
    ),
  ).toBe(0);
  await dialog.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use updated preview', exact: true }).click();
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await expect(dialog.getByText(/Saved 1 approved record/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.orders).toHaveLength(1);
  expect(saved.items[0].status).toBe('Sold');
  expect(saved.listings.map((l: { status: string }) => l.status)).toEqual([
    'Sold',
    'Needs delisting',
  ]);
  expect(saved.orders[0].lines[0].price).toBe(3500);
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).orders.length,
    ),
  ).toBe(1);
});
