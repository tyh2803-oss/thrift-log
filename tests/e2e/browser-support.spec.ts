import { test, expect } from '@playwright/test';
test('an insecure browser receives HTTPS guidance before any inventory or timer actions mount', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'isSecureContext', { value: false }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Open Thrift Log over HTTPS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open AI assistant' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('thrift-log.demo.v1'))).toBeNull();
});
