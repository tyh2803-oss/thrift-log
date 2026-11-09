import { test, expect, type Page } from '@playwright/test';
async function seed(page: Page, secondOrder = false) {
  await page.goto('/demo/sales');
  await page.waitForFunction(() => !!localStorage.getItem('thrift-log.demo.v1'));
  await page.evaluate((secondOrder) => {
    const w = JSON.parse(localStorage.getItem('thrift-log.demo.v1')!);
    const a = {
      ...w.items[0],
      id: '40000000-0000-4000-8000-000000000001',
      sku: 'LEDGER-A',
      title: 'Ledger jacket',
      cost: 1000,
      asking: 6000,
      status: 'Sold',
      tripId: null,
      photos: [],
      purchasedAt: '2026-09-01T12:00:00Z',
    };
    const b = {
      ...a,
      id: '40000000-0000-4000-8000-000000000002',
      sku: 'LEDGER-B',
      title: 'Ledger denim',
      cost: 2000,
      asking: 4000,
    };
    const order = {
      ...w.orders[0],
      id: '40000000-0000-4000-8000-000000000010',
      marketplace: 'Whatnot',
      externalId: 'LEDGER-ORDER',
      date: '2026-09-30T16:00:00Z',
      showId: null,
      lines: [
        { itemId: a.id, price: 6000, costBasis: 1000 },
        { itemId: b.id, price: 4000, costBasis: 2000 },
      ],
      discount: 0,
      shippingCollected: 0,
      fees: 1000,
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
    };
    w.items = [a, b];
    w.orders = [order];
    if (secondOrder) {
      const c = {
        ...a,
        id: '40000000-0000-4000-8000-000000000003',
        sku: 'LEDGER-C',
        title: 'Ledger tee',
        cost: 500,
        asking: 2000,
      };
      w.items.push(c);
      w.orders.push({
        ...order,
        id: '40000000-0000-4000-8000-000000000011',
        externalId: 'LEDGER-SECOND',
        lines: [{ itemId: c.id, price: 2000, costBasis: 500 }],
        fees: 200,
      });
    }
    for (const key of [
      'listings',
      'expenses',
      'shows',
      'trips',
      'locations',
      'sessions',
      'imports',
      'financialEvents',
      'payouts',
      'shipments',
    ])
      w[key] = [];
    w.revision = 0;
    localStorage.setItem('thrift-log.demo.v1', JSON.stringify(w));
  }, secondOrder);
  await page.reload();
  await page.getByRole('combobox', { name: 'Date range' }).selectOption('All time');
}
test('dated partial return preserves the sale month and returns only one piece', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Adjustments for LEDGER-ORDER' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Refund paid ($)').fill('60');
  await dialog.getByLabel('Event date').fill('2026-10-03T12:00');
  await dialog.getByLabel('LEDGER-A · Ledger jacket').check();
  await dialog.getByRole('textbox', { name: /^Reason/ }).fill('One jacket returned');
  await dialog.getByRole('button', { name: 'Record dated event' }).click();
  await expect(dialog.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('$10.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page
    .getByRole('link', { name: 'Insights', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.getByRole('combobox', { name: 'Date range' }).selectOption('Custom');
  await page.getByLabel('Custom start date').fill('2026-09-01');
  await page.getByLabel('Custom end date').fill('2026-09-30');
  await expect(page.locator('.statement-total')).toContainText('$60.00');
  await page.getByLabel('Custom start date').fill('2026-10-01');
  await page.getByLabel('Custom end date').fill('2026-10-31');
  await expect(page.locator('.statement-total')).toContainText('-$50.00');
  await page.goto('/demo/inventory');
  const rows = page.locator('tbody tr');
  await expect(rows.filter({ hasText: 'LEDGER-A' })).toContainText('Returned');
  await expect(rows.filter({ hasText: 'LEDGER-B' })).toContainText('Sold');
});
test('cash receipt and a shipping label remain separate from sale revenue', async ({ page }) => {
  await seed(page, true);
  await page.getByRole('button', { name: 'Shipments', exact: true }).click();
  await page.getByRole('button', { name: 'Create package', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/LEDGER-ORDER · Ledger jacket, Ledger denim/).check();
  await dialog.getByLabel(/LEDGER-SECOND · Ledger tee/).check();
  await dialog.getByLabel('Carrier').fill('USPS');
  await dialog.getByLabel('Tracking number').fill('TRACK-TEST');
  await dialog.getByLabel('Shipment status').selectOption('Shipped');
  await dialog.getByLabel('Label cost ($)').fill('5');
  await dialog.getByLabel(/Post and split this label cost once/).check();
  await dialog.getByRole('button', { name: 'Save package' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Allocated', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Payouts', exact: true }).click();
  await page.getByRole('button', { name: 'Record payout', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Payout reference').fill('CASH-TEST');
  await dialog.getByLabel('Cash received ($)').fill('103');
  await dialog.getByLabel(/LEDGER-ORDER · Ledger jacket, Ledger denim/).check();
  await dialog.getByLabel(/LEDGER-SECOND · Ledger tee/).check();
  await dialog.getByRole('button', { name: 'Record cash receipt' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('CASH-TEST', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('Paid');
  await expect(page.locator('tbody')).toContainText('$55.83');
  await expect(page.locator('tbody')).toContainText('$100.00');
  await expect(page.locator('tbody')).toContainText('Shipped');
});
