import { expect, test } from '@playwright/test';

test('mobile-friendly account creation uses the approved-email endpoint and preserves input while switching modes', async ({
  page,
}) => {
  const calls: unknown[] = [];
  await page.route('**/api/register', async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ json: { error: 'Ask the owner to authorize your email.' }, status: 400 });
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create Account', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Email', { exact: true }).fill('friend@example.test');
  await page.getByLabel('Password', { exact: true }).fill('A distinct beta password 123');
  await page.getByRole('button', { name: 'Create my account', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('authorize your email');
  expect(calls).toEqual([
    { email: 'friend@example.test', password: 'A distinct beta password 123' },
  ]);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('friend@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'autocomplete',
    'current-password',
  );
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'autocomplete',
    'new-password',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const label of ['Create Account', 'Create my account']) {
    const box = await page.getByRole('button', { name: label, exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  }
  await page.screenshot({ path: test.info().outputPath('registration.png'), fullPage: true });
});

test('prevents repeated submissions, displays limits, and supports the future email-confirmation response', async ({
  page,
}) => {
  let hits = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/register', async (route) => {
    hits++;
    await waiting;
    await route.fulfill({
      status: 429,
      json: { error: 'Too many attempts. Wait 15 minutes before trying again.' },
    });
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('friend@example.test');
  await page.getByLabel('Password', { exact: true }).fill('A distinct beta password 123');
  await page.getByRole('button', { name: 'Create my account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Creating account…', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('form').getByRole('alert')).toContainText('15 minutes');
  expect(hits).toBe(1);
  await page.unroute('**/api/register');
  await page.route('**/api/register', async (route) =>
    route.fulfill({
      json: {
        ok: true,
        confirmationRequired: true,
        message: 'Check your email to confirm your account before signing in.',
      },
    }),
  );
  await page.getByRole('button', { name: 'Create my account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  await expect(page).toHaveURL(/\/login$/);
});
