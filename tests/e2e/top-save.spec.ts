import { test, expect } from '@playwright/test';
test('top editor save uses native required-field validation and persists one record', async ({
  page,
}) => {
  await page.goto('/demo/inventory');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add inventory', exact: true });
  const save = dialog.getByRole('button', { name: 'Save form changes at top', exact: true });
  await expect(save).toBeInViewport();
  const form = dialog.locator('form');
  await save.click();
  expect(await form.evaluate((el: HTMLFormElement) => el.checkValidity())).toBe(false);
  await dialog.getByLabel('SKU', { exact: false }).fill('TOP-SAVE-ITEM');
  await dialog.getByLabel('Item title', { exact: false }).fill('Top save coat');
  await save.click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const w = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(w.items.filter((i: { sku: string }) => i.sku === 'TOP-SAVE-ITEM')).toHaveLength(1);
});
test('preferences can be saved at the top without changing theme or other settings', async ({
  page,
}) => {
  await page.goto('/demo/settings');
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).settings,
  );
  await page.getByLabel('Monthly profit goal ($)', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Save form changes at top', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Monthly profit goal ($)', { exact: true })).toHaveValue('200');
  const after = await page.evaluate(
    () => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!).settings,
  );
  expect(after).toEqual({ ...before, monthlyGoal: 20000 });
});
