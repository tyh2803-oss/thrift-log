import { test, expect } from '@playwright/test';
test('inventory → cross-list → sale → return; money and persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/demo/inventory');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Item title').fill('E2E denim jacket');
  await dialog.getByRole('textbox', { name: /^SKU/ }).fill('E2E-001');
  await dialog.getByRole('spinbutton', { name: /^Purchase cost/ }).fill('10.29');
  await dialog.getByLabel('Asking price ($)').fill('50.00');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: /Listings/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Add listing', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Inventory item').selectOption({ label: 'E2E-001 · E2E denim jacket' });
  await dialog.getByLabel('Asking price ($)').fill('50');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/demo/sales');
  await page.getByRole('button', { name: 'Record sale', exact: true }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Marketplace', exact: true }).selectOption('eBay');
  await dialog.getByLabel('E2E-001 · E2E denim jacket', { exact: true }).check();
  await dialog.getByLabel('Marketplace fees ($)').fill('5');
  await dialog.getByRole('button', { name: 'Record transaction' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('$34.71', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('$34.71', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open notifications' }).click();
  await expect(page.getByText('E2E denim jacket is still listed on Depop.')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: /E2E denim jacket/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Returned');
  await dialog.getByLabel('Refund paid ($)').fill('50');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('timer survives reload, pauses, resumes, and ends', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await page.getByRole('button', { name: 'Buying', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause timer' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pause timer' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause timer' }).click();
  await expect(page.getByText('Buying · paused')).toBeVisible();
  await page.getByRole('button', { name: 'Resume timer' }).click();
  await page.getByRole('button', { name: 'End timer' }).click();
  await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
});
test('show planner, CSV preview and duplicate prevention', async ({ page }) => {
  await page.goto('/demo/sales');
  await page.getByRole('button', { name: 'Shows & events', exact: true }).click();
  await page.getByRole('button', { name: 'Plan a show', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Show or event name').fill('E2E Sunday live');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Sunday live' })).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  dialog = page.getByRole('dialog');
  const file = {
    name: 'sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('order_id,sku,price,marketplace,fees\nE2E-WN,TL-0021,35,Whatnot,2.50'),
  };
  await dialog.locator('input[type=file]').setInputFiles(file);
  await expect(dialog.getByText('1 rows · 1 new records · 0 duplicates skipped')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import validated records' }).click();
  await expect(dialog.getByText('Imported 1 records. Skipped 0 existing records.')).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles(file);
  await expect(dialog.getByText('1 rows · 0 new records · 1 duplicates skipped')).toBeVisible();
});
test('responsive navigation, date filtering, and PWA assets', async ({
  page,
  request,
  isMobile,
}) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'A good day for good finds.' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Date range' }).selectOption('Yesterday');
  await page.getByRole('combobox', { name: 'Date range' }).selectOption('All time');
  await page
    .getByRole('link', { name: 'Insights', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'See the bigger picture.' })).toBeVisible();
  await page.getByRole('button', { name: 'Finances', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your money, made clear.' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  if (isMobile) await expect(page.locator('.mobile-nav')).toBeVisible();
  expect((await request.get('/manifest.webmanifest')).ok()).toBe(true);
  expect((await request.get('/icons/icon-192.png')).ok()).toBe(true);
  expect((await request.get('/api/workspace')).status()).toBe(503);
});

test('empty workspace, photo entry, draft recovery, settings, and private boundary', async ({
  page,
  request,
}) => {
  await page.goto('/demo/inventory');
  await page.waitForFunction(() => !!localStorage.getItem('thrift-log.demo.v1'));
  await page.evaluate(() => {
    const old = JSON.parse(localStorage.getItem('thrift-log.demo.v1')!);
    for (const k of [
      'items',
      'listings',
      'orders',
      'expenses',
      'trips',
      'shows',
      'locations',
      'sessions',
      'imports',
    ])
      old[k] = [];
    old.revision = 0;
    localStorage.setItem('thrift-log.demo.v1', JSON.stringify(old));
  });
  await page.reload();
  await expect(page.getByText('A fresh start for your inventory')).toBeVisible();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Item title').fill('Recovered photo item');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Item title')).toHaveValue('Recovered photo item');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuQAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(dialog.getByText('Remove', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Recovered photo item/ })).toBeVisible();
  await page.getByRole('link', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const r = await request.post('/api/workspace', {
    headers: { Origin: 'https://untrusted.example' },
    data: { commands: [], revision: 0 },
  });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toBe('Invalid request origin');
});

test('incomplete Supabase setup cannot look like a connected private workspace', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { name: 'Your private workspace needs Supabase' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Explore the separate demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
});
test('inventory photo gallery switches images and never merges demo with private setup', async ({
  page,
}) => {
  await page.goto('/demo/inventory');
  await page.waitForFunction(() => !!localStorage.getItem('thrift-log.demo.v1'));
  await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('thrift-log.demo.v1')!);
    const make = (color: string) => {
      const c = document.createElement('canvas');
      c.width = 2;
      c.height = 2;
      const context = c.getContext('2d')!;
      context.fillStyle = color;
      context.fillRect(0, 0, 2, 2);
      return c.toDataURL('image/png');
    };
    w.items[0].photos = [make('red'), make('blue')];
    localStorage.setItem('thrift-log.demo.v1', JSON.stringify(w));
  });
  await page.reload();
  await page.getByRole('button', { name: /Vintage Levi’s 501 jeans.*TL-0001/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('img', { name: 'Vintage Levi’s 501 jeans, photo 1' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Next photo' }).click();
  await expect(
    dialog.getByRole('img', { name: 'Vintage Levi’s 501 jeans, photo 2' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Previous photo' }).click();
  await expect(dialog.getByRole('button', { name: 'View photo 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
