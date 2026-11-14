import { test, expect } from '@playwright/test';
const picture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuQAAAAASUVORK5CYII=',
  'base64',
);
test('profile dropdown supports keyboard/outside dismissal, settings navigation, and a demo photo without private requests', async ({
  page,
}) => {
  let privateCalls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/profile')) privateCalls++;
  });
  await page.goto('/demo');
  const button = page.getByRole('button', { name: 'Open profile menu', exact: true });
  await button.focus();
  await button.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Your account', exact: true });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Add profile photo', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Sign in', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await page.locator('main').click({ position: { x: 4, y: 360 } });
  await expect(menu).toHaveCount(0);
  await button.click();
  await menu.getByRole('menuitem', { name: 'Open settings', exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/settings$/);
  await expect(menu).toHaveCount(0);
  await button.click();
  await menu.getByRole('menuitem', { name: 'Add profile photo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your profile', exact: true });
  await dialog
    .getByLabel('Choose profile photo')
    .setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: picture });
  await expect(dialog.getByRole('status')).toHaveText('Profile photo saved in this demo browser.');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(button.locator('img')).toBeVisible();
  await button.click();
  await menu.getByRole('menuitem', { name: 'Change profile photo', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(privateCalls).toBe(0);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('profile-dialog.png') });
});
test('narrow profile menu has comfortable touch targets and never extends beyond the screen', async ({
  page,
}) => {
  await page.goto('/demo');
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const trigger = page.getByRole('button', { name: 'Open profile menu' });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Your account' });
    // Measure settled geometry rather than compositor rounding during its 3px entrance.
    await menu.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))),
    );
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const item of await menu.getByRole('menuitem').all())
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`profile-menu-${width}.png`) });
    await page.keyboard.press('Escape');
  }
});
