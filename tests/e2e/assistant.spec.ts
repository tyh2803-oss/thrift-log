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
  await expect(dialog.getByRole('button', { name: 'Remove sale.png' })).toBeVisible();
  await dialog.getByLabel('Message assistant').fill('Log this sale.');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Sign in');
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove sale.png' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove sale.png' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove sale.png' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Clear chat' }).click();
  const sharp = (await import('sharp')).default;
  const large = await sharp({
    create: { width: 1290, height: 2796, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  await dialog
    .getByLabel('Screenshot files')
    .setInputFiles({ name: 'readable-detail.png', mimeType: 'image/png', buffer: large });
  const preview = dialog.getByRole('img', { name: 'readable-detail.png', exact: true });
  await expect(preview).toBeVisible();
  expect(
    await preview.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]),
  ).toEqual([1290, 2796]);
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
  await page.screenshot({
    animations: 'disabled',
    path: `test-results/assistant-review-${page.viewportSize()!.width}.png`,
  });
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
  await expect(dialog.getByRole('button', { name: 'Mark Shipped', exact: true })).toHaveCount(0);
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
  await dialog.getByRole('button', { name: 'Mark Shipped', exact: true }).click();
  await expect(dialog.getByText(/Fulfillment saved/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.orders).toHaveLength(1);
  expect(saved.items[0].status).toBe('Sold');
  expect(saved.listings.map((l: { status: string }) => l.status)).toEqual([
    'Sold',
    'Needs delisting',
  ]);
  expect(saved.orders[0].lines[0].price).toBe(3500);
  expect(saved.orders[0].fulfillment).toBe('Shipped');
  expect(saved.orders[0].shipping).toBe(300);
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).orders.length,
    ),
  ).toBe(1);
});

test('listing review creates new inventory only after cost entry and updates existing listings in one batch', async ({
  page,
}) => {
  const w = assistantWorkspace();
  const records = [
    extractedSale({
      kind: 'listing',
      status: 'active',
      externalOrderId: null,
      lines: [extractedLine({ listingId: 'listing-1', price: 4800 })],
    }),
    extractedSale({
      kind: 'listing',
      status: 'active',
      externalOrderId: null,
      marketplace: 'Depop',
      lines: [
        extractedLine({
          title: 'Red leather boots',
          brand: 'Other',
          size: '7',
          color: 'Red',
          listingId: 'boots-1',
          price: 6000,
        }),
      ],
    }),
  ];
  const batch = createBatch(
    [{ hash: 'b'.repeat(64), name: 'listings.png', extraction: { records, message: '' } }],
    w,
  );
  await page.goto('/demo/inventory');
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
  const rows = dialog.locator('.assistant-extraction');
  await expect(rows.nth(1).getByText('Suggested new physical item · Not saved')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeEnabled();
  await rows.nth(1).getByLabel('Purchase Cost ($)', { exact: true }).fill('15');
  await rows.nth(1).getByLabel('Acquisition date, line 1', { exact: true }).fill('2026-10-02');
  await rows
    .nth(1)
    .getByText('I checked inventory and confirm this is a new physical item.')
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).items.length),
  ).toBe(1);
  await dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }).click();
  await expect(dialog.getByText(/Saved 2 approved records/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page
    .getByRole('button', { name: /^Listings/ })
    .first()
    .click();
  const summary = page.getByRole('region', { name: 'Listing summary' });
  await expect(summary).toContainText('Physical inventory items2');
  await expect(summary).toContainText('$27.00');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toHaveLength(2);
  expect(saved.listings).toHaveLength(3);
  expect(saved.orders).toHaveLength(0);
  await page.getByLabel('Filter marketplace').selectOption('Depop');
  await expect(page.locator('table tbody tr')).toHaveCount(2);
  // Re-importing the original screenshot facts produces no ready changes.
  const repeat = createBatch(
    [{ hash: 'b'.repeat(64), name: 'listings.png', extraction: { records, message: '' } }],
    saved,
  );
  await page.evaluate(
    (b) => sessionStorage.setItem('thrift-log.draft.assistant.demo', JSON.stringify(b)),
    repeat,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
});

test('clothing cards expose evidence, editable vintage and uncertain marketplace without saving', async ({
  page,
}) => {
  const { emptyClothing, normalizeVision } = await import('../../src/lib/assistant/vision');
  const w = assistantWorkspace();
  const clothing = emptyClothing();
  clothing.garmentType = 'Collegiate pullover jacket';
  clothing.design = 'Readable campus lettering';
  clothing.visibleText = 'Original card text';
  clothing.vintage.classification = 'Potentially vintage';
  clothing.vintage.evidence = ['Ribbed trim and collegiate silhouette; age unverified'];
  clothing.evidence = [
    { field: 'garmentType', source: 'appearance', note: 'Pullover silhouette visible' },
  ];
  clothing.region = { left: 0, top: 0, right: 500, bottom: 500 };
  const extraction = normalizeVision({
    identification: {
      detected: null,
      confidence: 'uncertain',
      evidence: ['Cropped header; marketplace identity cannot be established'],
    },
    records: [
      extractedSale({
        kind: 'listing',
        status: 'active',
        lines: [
          extractedLine({ sku: w.items[0].sku, price: 4600, clothing }),
          extractedLine({
            brand: 'Other',
            title: 'Second independent garment',
            price: 1800,
            clothing,
          }),
        ],
      }),
    ],
    message: '',
  });
  const batch = createBatch(
    [{ hash: 'e'.repeat(64), name: 'clothes.png', reference: 'private-fixture', extraction }],
    w,
  );
  await page.route('**/api/photos?path=private-fixture', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: image.buffer }),
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
  const rows = dialog.locator('.assistant-extraction');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Collegiate pullover jacket');
  await expect(rows.nth(0)).toContainText('Potentially vintage');
  await expect(rows.nth(0)).toContainText('Age unverified');
  await expect(rows.nth(0).getByRole('img')).toHaveCount(1);
  await rows.nth(0).getByText('Visual evidence and original text', { exact: true }).click();
  await expect(rows.nth(0)).toContainText('Pullover silhouette visible');
  await expect(rows.nth(0)).toContainText('Original card text');
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
  await rows.nth(0).getByRole('button', { name: 'Edit', exact: true }).click();
  await rows
    .nth(0)
    .getByRole('combobox', { name: 'Marketplace', exact: true })
    .selectOption('Vinted');
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeEnabled();
  await rows.nth(0).getByText('Edit additional details', { exact: true }).click();
  await rows
    .nth(0)
    .getByRole('combobox', { name: 'Vintage classification', exact: true })
    .selectOption('Vintage confirmed');
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeEnabled();
  await expect(rows.nth(0)).toContainText('Potentially vintage');
  await rows
    .nth(0)
    .getByRole('combobox', { name: 'Vintage classification', exact: true })
    .selectOption('Insufficient evidence');
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    animations: 'disabled',
    path: `test-results/clothing-review-${page.viewportSize()!.width}.png`,
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(stored).toEqual(w);
});

test('inline listing costs, prices, marketplaces and details remain independent until batch approval', async ({
  page,
}) => {
  const w = assistantWorkspace();
  w.settings.estimatedSellingExpenses = 250;
  const records = ['White campus pullover', 'Light wash jeans'].map((title, i) =>
    extractedSale({
      kind: 'listing',
      status: 'active',
      externalOrderId: null,
      marketplace: 'Vinted',
      lines: [
        extractedLine({
          title,
          brand: null,
          listingId: `inline-${i}`,
          price: i === 0 ? 4500 : 1000,
        }),
      ],
    }),
  );
  const batch = createBatch(
    [{ hash: 'f'.repeat(64), name: 'two-listings.png', extraction: { records, message: '' } }],
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
  const dialog = page.getByRole('dialog'),
    rows = dialog.locator('.assistant-extraction');
  const first = rows.nth(0),
    second = rows.nth(1);
  await expect(first.getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('');
  await expect(first.getByLabel('Purchase Cost ($)', { exact: true })).toHaveAttribute(
    'inputmode',
    'decimal',
  );
  await expect(first).toContainText('Potential gross profit: Cost needed');
  await first.getByLabel('Purchase Cost ($)', { exact: true }).fill('13.27');
  await first.getByLabel('Listing Price ($)', { exact: true }).fill('45.50');
  await first.getByRole('combobox', { name: 'Marketplace', exact: true }).selectOption('eBay');
  await expect(first).toContainText('Potential gross profit: $32.23');
  await expect(first).toContainText('Estimated net profit: $29.73');
  await expect(second.getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('');
  await second.getByLabel('Purchase Cost ($)', { exact: true }).fill('0');
  await second.getByLabel('Listing Price ($)', { exact: true }).fill('5.01');
  await second.getByRole('combobox', { name: 'Marketplace', exact: true }).selectOption('Whatnot');
  await expect(second).toContainText('Potential gross profit: $5.01');
  await first.getByText('Edit additional details', { exact: true }).click();
  await first.getByLabel('Item title', { exact: true }).fill('Corrected campus pullover');
  await first.getByLabel('Import notes', { exact: true }).fill('Inspected ribbed trim.');
  await first.getByText('Edit additional details', { exact: true }).click();
  // New drafts are automatic; physical identity still requires explicit confirmation.
  for (const row of [first, second]) {
    await row.getByLabel('Acquisition date, line 1', { exact: true }).fill('2026-10-02');
    await row
      .getByText('I checked inventory and confirm this is a new physical item.', { exact: true })
      .click();
  }
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }),
  ).toBeEnabled();
  await first.getByLabel('Purchase Cost ($)', { exact: true }).fill('1.234');
  await expect(first.getByLabel('Purchase Cost ($)', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeEnabled();
  await first.getByLabel('Purchase Cost ($)', { exact: true }).fill('13.27');
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await expect(first.getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('13.27');
  await expect(second.getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('0');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(before).toEqual(w);
  const fits = await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
  await first.getByRole('button', { name: 'Skip', exact: true }).scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    animations: 'disabled',
    path: `test-results/inline-listings-${page.viewportSize()!.width}.png`,
  });
  await dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }).click();
  await expect(dialog.getByText(/Saved 2 approved records/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toHaveLength(3);
  expect(
    saved.items.find((i: { title: string }) => i.title === 'Corrected campus pullover'),
  ).toMatchObject({ cost: 1327, notes: 'Inspected ribbed trim.' });
  expect(saved.items.find((i: { title: string }) => i.title === 'Light wash jeans').cost).toBe(0);
  expect(
    saved.listings.find((l: { externalId: string }) => l.externalId === 'inline-0'),
  ).toMatchObject({ marketplace: 'eBay', price: 4550 });
  expect(
    saved.listings.find((l: { externalId: string }) => l.externalId === 'inline-1'),
  ).toMatchObject({ marketplace: 'Whatnot', price: 501 });
  expect(saved.orders).toHaveLength(0);
});

test('batch trash and confirmed Clear All discard only drafts and partial approval keeps current revision', async ({
  page,
}) => {
  const w = assistantWorkspace();
  const records = [
    extractedSale({
      kind: 'listing',
      status: 'active',
      externalOrderId: null,
      lines: [extractedLine({ sku: w.items[0].sku, listingId: 'listing-1', price: 4800 })],
    }),
    ...['Pending hoodie', 'Pending jeans'].map((title, i) =>
      extractedSale({
        kind: 'listing',
        status: 'active',
        marketplace: 'eBay',
        externalOrderId: null,
        lines: [
          extractedLine({
            title,
            brand: null,
            size: null,
            color: null,
            listingId: `pending-${i}`,
            price: 2000,
          }),
        ],
      }),
    ),
  ];
  const batch = createBatch(
    [{ hash: 'd'.repeat(64), name: 'mixed-ready.png', extraction: { records, message: '' } }],
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
  const dialog = page.getByRole('dialog'),
    rows = dialog.locator('.assistant-extraction');
  await expect(rows).toHaveCount(3);
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }),
  ).toBeInViewport();
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await expect(rows).toHaveCount(2);
  const current = await page.evaluate(() => ({
    w: JSON.parse(localStorage.getItem('thrift-log.demo.v1')!),
    b: JSON.parse(sessionStorage.getItem('thrift-log.draft.assistant.demo')!),
  }));
  expect(current.b.revision).toBe(current.w.revision);
  expect(current.w.items).toHaveLength(1);
  expect(current.w.listings[0].price).toBe(4800);
  await dialog.getByLabel('Message assistant').fill('The first item cost me $8.');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(rows.nth(0).getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('8');
  await dialog.getByLabel('Message assistant').fill('Approve everything');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByText(/0 records are ready/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove pending record 1', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Pending jeans');
  await dialog.getByRole('button', { name: 'Clear All', exact: true }).click();
  await expect(dialog.getByText(/Discard all pending drafts/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep drafts', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Clear All', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard pending drafts', exact: true }).click();
  await expect(rows).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!)),
  ).toEqual(current.w);
});

test('mixed sale and shipment drafts approve together and create one physical sale', async ({
  page,
}) => {
  const w = assistantWorkspace();
  const sale = extractedSale({ lines: [extractedLine({ sku: w.items[0].sku })] });
  const shipped = extractedSale({
    kind: 'fulfillment',
    status: 'shipped',
    date: '2026-11-09',
    event: {
      type: 'shipped',
      confidence: 'clear',
      evidence: ['Carrier acceptance confirmed'],
      scope: 'order',
      carrier: 'Carrier',
      tracking: 'TEST-TRACK',
      labelCost: null,
      externalEventId: null,
    },
  });
  const batch = createBatch(
    [shipped, sale].map((r, i) => ({
      hash: String(i + 5).repeat(64),
      name: `event-${i}.png`,
      extraction: { message: '', records: [r] },
    })),
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
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Mark Shipped', exact: true })).toHaveCount(0);
  const order = dialog.getByRole('combobox', { name: 'Existing order', exact: true });
  await expect(order).toHaveValue(batch.rows[1].id);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).orders.length,
    ),
  ).toBe(0);
  await dialog.getByRole('button', { name: 'Approve All Ready (2)', exact: true }).click();
  await expect(dialog.getByText(/Saved 2 approved records/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.orders).toHaveLength(1);
  expect(saved.items).toHaveLength(1);
  expect(saved.orders[0]).toMatchObject({ fulfillment: 'Shipped', fees: 400, shipping: 300 });
  expect(saved.shipments).toHaveLength(0);
  expect(saved.financialEvents).toHaveLength(0);
});

import { fiveUnknownListings } from '../helpers/assistant';
import { emptyWorkspace } from '../../src/lib/model';
import { inventoryPipeline } from '../../src/lib/pipeline';
test('five unknown listing screenshots can be completed inline and approved together in an empty workspace', async ({
  page,
}) => {
  const w = emptyWorkspace(),
    batch = fiveUnknownListings(w);
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
  const dialog = page.getByRole('dialog'),
    rows = dialog.locator('.assistant-extraction');
  await expect(rows).toHaveCount(5);
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
  const shortcut = dialog.getByRole('button', { name: 'Review missing information', exact: true });
  await shortcut.click();
  await expect(
    rows.first().getByRole('checkbox', {
      name: 'I checked inventory and confirm this is a new physical item.',
    }),
  ).toBeFocused();
  for (let index = 0; index < 5; index++) {
    const row = rows.nth(index);
    await expect(row.getByText('To become Ready:', { exact: true })).toBeVisible();
    await row
      .getByRole('checkbox', {
        name: 'I checked inventory and confirm this is a new physical item.',
      })
      .check();
    await row.getByLabel('Acquisition date, line 1', { exact: true }).fill('2026-10-01');
  }
  // Dates and confirmations alone must never turn missing costs into free inventory.
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
  await shortcut.click();
  await expect(rows.first().getByLabel('Purchase Cost ($)', { exact: true })).toBeFocused();
  for (let index = 0; index < 5; index++) {
    const cost = rows.nth(index).getByLabel('Purchase Cost ($)', { exact: true });
    await cost.fill(String(index * 5)); // Deliberately confirm one zero cost.
    const bounds = await cost.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (index < 4) {
      await shortcut.click();
      await expect(
        rows.nth(index + 1).getByLabel('Purchase Cost ($)', { exact: true }),
      ).toBeFocused();
    }
  }
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (5)', exact: true }),
  ).toBeEnabled();
  await expect(dialog.locator('.assistant-readiness')).toHaveCount(0);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).items.length),
  ).toBe(0);
  await page.screenshot({
    animations: 'disabled',
    path: `test-results/five-listings-${page.viewportSize()!.width}.png`,
  });
  // Pending edits survive reload without opening Edit or any nested detail menu.
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  await dialog.getByRole('button', { name: 'Approve All Ready (5)', exact: true }).click();
  await expect(dialog.getByText(/Saved 5 approved records/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toHaveLength(5);
  expect(saved.listings).toHaveLength(5);
  expect(new Set(saved.listings.map((l: { itemId: string }) => l.itemId)).size).toBe(5);
  expect(inventoryPipeline(saved).groups['for-sale'].count).toBe(5);
  expect(saved.items.map((i: { cost: number }) => i.cost)).toEqual([0, 500, 1000, 1500, 2000]);
  await page.reload();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).items.length),
  ).toBe(5);
});

test('inline inventory suggestions reuse a physical item and missing-information shortcut reveals invalid optional details', async ({
  page,
}) => {
  const w = assistantWorkspace();
  const batch = createBatch(
    [
      {
        hash: 'd'.repeat(64),
        name: 'possible-match.png',
        extraction: {
          message: '',
          records: [
            extractedSale({
              kind: 'listing',
              status: 'active',
              marketplace: 'eBay',
              date: null,
              externalOrderId: null,
              lines: [extractedLine({ listingId: 'candidate-only' })],
            }),
          ],
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
  const dialog = page.getByRole('dialog'),
    row = dialog.locator('.assistant-extraction');
  await expect(row.getByText('Suggested new physical item · Not saved')).toBeVisible();
  await row.getByRole('button', { name: /Use possible match:/ }).click();
  await expect(row.getByLabel('Acquisition date, line 1', { exact: true })).toHaveCount(0);
  await expect(row.getByLabel('Purchase Cost ($)', { exact: true })).toHaveValue('12');
  await expect(row.getByLabel('Purchase Cost ($)', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await row.getByLabel('Listing Price ($)', { exact: true }).fill('42.50');
  await row.getByLabel('Marketplace', { exact: true }).selectOption('Whatnot');
  await row.getByText('Edit additional details', { exact: true }).click();
  const date = row.getByLabel('Listing date (workspace timezone)', { exact: true });
  await date.fill('invalid date');
  await row.getByText('Edit additional details', { exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Approve All Ready (0)', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Review missing information', exact: true }).click();
  await expect(date).toBeFocused();
  await date.fill(''); // Original listing date is optional.
  await dialog.getByRole('button', { name: 'Approve All Ready (1)', exact: true }).click();
  await expect(dialog.getByText(/Saved 1 approved record/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.items).toEqual(w.items);
  expect(saved.listings).toHaveLength(3);
  expect(
    saved.listings.find((l: { marketplace: string }) => l.marketplace === 'Whatnot'),
  ).toMatchObject({ itemId: w.items[0].id, price: 4250 });
});
