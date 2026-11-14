import { test, expect, type Page } from '@playwright/test';
import { assistantWorkspace, extractedLine, extractedSale } from '../helpers/assistant';
import { createBatch, type DraftBatch } from '../../src/lib/assistant/drafts';
import { emptyWorkspace, type Workspace } from '../../src/lib/model';
import { localDay } from '../../src/lib/dates';
import { inventoryPipeline } from '../../src/lib/pipeline';

function fixtures(w = emptyWorkspace(), count = 4, shared = false) {
  const batch = createBatch(
    [
      {
        hash: 'a'.repeat(64),
        name: 'active-listings.png',
        extraction: {
          message: '',
          records: Array.from({ length: count }, (_, i) =>
            extractedSale({
              kind: 'listing',
              status: 'active',
              date: null,
              externalOrderId: null,
              marketplace: shared && i === 1 ? 'Depop' : 'Vinted',
              lines: [
                extractedLine({
                  title: `Garment ${i + 1}`,
                  brand: null,
                  size: null,
                  color: null,
                  sku: shared && i < 2 ? 'CROSS-LISTED' : null,
                  listingId: `active-${i}`,
                  price: 2650,
                }),
              ],
            }),
          ),
        },
      },
    ],
    w,
  );
  // This fixture explicitly identifies one cross-listed physical item; names/SKUs alone do not merge it.
  if (shared) batch.rows[1].matches[0].newItem = structuredClone(batch.rows[0].matches[0].newItem);
  return batch;
}
async function load(page: Page, w: Workspace, batch: DraftBatch) {
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
  await expect(dialog.locator('.assistant-compact-card')).toHaveCount(batch.rows.length);
  await dialog.locator('.assistant-thread').evaluate((el) => (el.scrollTop = 0));
  return dialog;
}
test('four collapsed listings need only four cost entries and one approval; iPhone controls never overlap inputs', async ({
  page,
}) => {
  const w = emptyWorkspace(),
    batch = fixtures(w),
    dialog = await load(page, w, batch),
    cards = dialog.locator('.assistant-compact-card');
  await expect(dialog.locator('.compact-listing-details[open]')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByLabel('Batch acquisition date')).toHaveValue(
    localDay(new Date(), w.settings.timezone),
  );
  await expect(
    dialog.getByText('Assumed date; Approve All accepts. Change if earlier.'),
  ).toBeVisible();
  const footer = dialog.locator('.compact-approval-footer');
  await expect(
    footer.getByRole('button', { name: 'Approve All (0)', exact: true }),
  ).toBeInViewport();
  if (page.viewportSize()!.width < 500) {
    const bounds = await cards.first().boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(140);
    const third = await cards.nth(2).boundingBox(),
      foot = await footer.boundingBox();
    expect(third!.y + third!.height).toBeLessThanOrEqual(foot!.y);
  }
  for (let i = 0; i < 4; i++) {
    const cost = cards.nth(i).getByLabel('Purchase Cost ($)', { exact: true });
    await cost.fill(['10', '20', '0', '5'][i]);
    const box = await cost.boundingBox(),
      foot = await footer.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.y + box!.height).toBeLessThanOrEqual(foot!.y + 1);
  }
  await expect(dialog.getByRole('heading', { name: 'Your Thrift Log assistant' })).toBeInViewport();
  await expect(footer).toContainText('4 items ready');
  await expect(footer).toContainText('$106.00 asking value');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/compact-review-${page.viewportSize()!.width}.png`,
    animations: 'disabled',
  });
  await footer.getByRole('button', { name: 'Approve All (4)', exact: true }).click();
  await expect(dialog.getByText(/Saved 4 approved records/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toHaveLength(4);
  expect(saved.listings).toHaveLength(4);
  expect(saved.items.map((i: { cost: number }) => i.cost)).toEqual([1000, 2000, 0, 500]);
  expect(inventoryPipeline(saved).groups['for-sale'].count).toBe(4);
});
test('Batch Cost splits cents over unique physical items, preserves overrides through expansion and adjusts batch dates', async ({
  page,
}) => {
  const w = emptyWorkspace(),
    dialog = await load(page, w, fixtures(w, 4, true)),
    cards = dialog.locator('.assistant-compact-card');
  await dialog.getByRole('button', { name: 'Batch Cost', exact: true }).click();
  await dialog.getByLabel('Cost mode').selectOption('split');
  await dialog.getByLabel('Total batch cost ($)').fill('10.01');
  await expect(dialog.getByText('3 eligible new physical items.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply cost', exact: true }).click();
  for (const [i, cost] of ['3.34', '3.34', '3.34', '3.33'].entries())
    await expect(cards.nth(i).getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue(cost);
  await cards.nth(1).getByLabel('Purchase Cost ($)', { exact: true }).fill('4.50');
  await expect(cards.first().getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('4.50');
  await cards.first().locator('.compact-listing-details > summary').click();
  await cards.first().locator('.compact-listing-details > summary').click();
  await expect(cards.first().getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('4.50');
  await dialog.getByLabel('Batch acquisition date').fill('2026-10-01');
  await dialog.getByRole('button', { name: 'Approve All (4)', exact: true }).click();
  await expect(dialog.getByText(/Saved 4 approved records/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toHaveLength(3);
  expect(saved.listings).toHaveLength(4);
  expect(
    saved.items.every(
      (i: { purchasedAt: string; notes: string }) =>
        i.purchasedAt.startsWith('2026-10-01') && !i.notes.includes('assumed'),
    ),
  ).toBe(true);
});
test('ten new listings receive $5 each from a $50 total, support individual costs and deletion stays pending', async ({
  page,
}) => {
  const w = emptyWorkspace(),
    dialog = await load(page, w, fixtures(w, 10));
  await dialog.getByRole('button', { name: 'Batch Cost', exact: true }).click();
  await dialog.getByLabel('Cost mode').selectOption('split');
  await dialog.getByLabel('Total batch cost ($)').fill('50');
  await dialog.getByRole('button', { name: 'Apply cost', exact: true }).click();
  const inputs = dialog
    .locator('.assistant-compact-card')
    .getByLabel('Purchase Cost ($)', { exact: true });
  for (let i = 0; i < 10; i++) await expect(inputs.nth(i)).toHaveValue('5.00');
  await dialog.getByLabel('Cost mode').selectOption('individual');
  await inputs.first().fill('6.25');
  await dialog.getByRole('button', { name: 'Remove pending record 2', exact: true }).click();
  await expect(dialog.locator('.assistant-compact-card')).toHaveCount(9);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).items.length),
  ).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await expect(
    dialog
      .locator('.assistant-compact-card')
      .first()
      .getByLabel('Purchase Cost ($)', { exact: true }),
  ).toHaveValue('6.25');
  await dialog.getByRole('button', { name: 'Approve All (9)', exact: true }).click();
  await expect(dialog.getByText(/Saved 9 approved records/)).toBeVisible();
});
test('similar inventory never blocks a new proposal and existing recorded costs are protected from batch edits', async ({
  page,
}) => {
  const w = assistantWorkspace(),
    batch = fixtures(w, 2);
  batch.rows[0].facts.lines[0] = extractedLine({ listingId: 'new-candidate', price: 4600 });
  batch.rows[1].facts.lines[0].sku = w.items[0].sku;
  batch.rows[1].matches[0] = { itemId: w.items[0].id, newItem: null, confirmZeroCost: false };
  batch.rows[1].facts.marketplace = 'eBay';
  const dialog = await load(page, w, batch),
    cards = dialog.locator('.assistant-compact-card');
  await expect(cards.first().getByText('Possible existing item', { exact: true })).toHaveCount(0);
  await expect(
    cards.first().getByRole('button', { name: 'Create different item', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Batch Cost', exact: true }).click();
  await dialog.getByLabel('Cost per item ($)').fill('0');
  await dialog.getByRole('button', { name: 'Apply cost', exact: true }).click();
  await expect(cards.nth(1).getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('12');
  await expect(cards.first().getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('0.00');
  await dialog.getByRole('button', { name: 'Approve All (2)', exact: true }).click();
  await expect(dialog.getByText(/Saved 2 approved records/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toHaveLength(2);
  expect(saved.items.find((i: { id: string }) => i.id === w.items[0].id).cost).toBe(1200);
});

test('an explicit pending-item match joins cross-listings before cost allocation', async ({
  page,
}) => {
  const w = emptyWorkspace(),
    batch = fixtures(w);
  batch.rows[1].facts.marketplace = 'Depop';
  const dialog = await load(page, w, batch),
    cards = dialog.locator('.assistant-compact-card');
  await cards.nth(1).locator('.compact-listing-details > summary').click();
  await cards
    .nth(1)
    .getByLabel('Same physical item as another proposal')
    .selectOption(batch.rows[0].matches[0].newItem!.id);
  await cards.nth(1).locator('.compact-listing-details > summary').click();
  await dialog.getByRole('button', { name: 'Batch Cost', exact: true }).click();
  await expect(dialog.getByText('3 eligible new physical items.', { exact: false })).toBeVisible();
  await dialog.getByLabel('Cost mode').selectOption('same');
  await dialog.getByLabel('Cost per item ($)').fill('5');
  await dialog.getByRole('button', { name: 'Apply cost', exact: true }).click();
  await dialog.getByRole('button', { name: 'Approve All (4)', exact: true }).click();
  await expect(dialog.getByText(/Saved 4 approved records/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toHaveLength(3);
  expect(saved.listings).toHaveLength(4);
});
