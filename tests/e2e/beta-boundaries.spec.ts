import { test, expect } from '@playwright/test';
test('the separate demo exposes no beta management or private account drafts', async ({ page }) => {
  const betaRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/beta')) betaRequests.push(r.url());
  });
  await page.goto('/demo/settings?isOwner=true&userId=11111111-1111-4111-8111-111111111111');
  await expect(page.getByText('Fictional sample data, saved in this browser.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beta testers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send invitation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(betaRequests).toEqual([]);
  const keys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(keys.some((key) => key.startsWith('thrift-log.draft.private.'))).toBe(false);
});
test('public requests cannot reach password setup, tester management or registration', async ({
  page,
  request,
}) => {
  await page.goto('/set-password');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toHaveCount(0);
  for (const path of ['/api/beta', '/api/workspace']) {
    const r = await request.get(path);
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(await r.text()).not.toContain('tester@example.test');
  }
  const signup = await request.post('/api/auth', {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      action: 'signup',
      email: 'not-registered@example.test',
      password: 'not-a-real-password',
    },
  });
  expect(signup.status()).toBe(400);
  const disabledRegistration = await request.post('/api/register', {
    headers: { Origin: new URL(page.url()).origin },
    data: { email: 'not-registered@example.test', password: 'not-a-real-password' },
  });
  expect(disabledRegistration.status()).toBe(503);
  await page.goto(
    '/auth/confirm?type=signup&token_hash=invalid-test-token&next=https://evil.example',
  );
  await expect(page).toHaveURL(/\/login\?error=invite$/);
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
});
