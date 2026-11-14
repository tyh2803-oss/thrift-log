import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __motionSamples: { animation: Animation; target: Element }[];
    __pauseMotion: boolean;
  }
}
const nav = (page: Page, name: string) =>
  page
    .locator(page.viewportSize()!.width < 900 ? '.mobile-nav' : '.sidebar nav')
    .getByRole('link', { name: new RegExp(`^${name}(?: \\d+)?$`) });
const count = (page: Page) =>
  page.evaluate(
    () =>
      window.__motionSamples.filter(({ animation }) => animation.id === 'content-transition')
        .length,
  );
const snapshot = (page: Page) => page.evaluate(() => localStorage.getItem('thrift-log.demo.v1'));

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.__motionSamples = [];
    window.__pauseMotion = false;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      window.__motionSamples.push({ animation, target: this });
      if (window.__pauseMotion) animation.pause();
      return animation;
    };
  });
});

test('navigation and local view changes use brief nonblocking fades without remounting inputs or animating edits', async ({
  page,
}) => {
  await page.goto('/demo');
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  const before = await snapshot(page);
  await nav(page, 'Inventory').click();
  await expect(
    page.getByRole('heading', { name: 'Every piece, in its place.', exact: true }),
  ).toBeVisible();
  await expect.poll(() => count(page)).toBe(1);
  await expect(page).toHaveURL(/\/demo\/inventory$/);
  const surface = await page.locator('.view-surface').elementHandle();
  await page.getByRole('button', { name: /^Listings \d+/ }).click();
  await expect(page.getByRole('region', { name: 'Listing summary' })).toBeVisible();
  await expect.poll(() => count(page)).toBe(2);
  expect(await surface!.evaluate((el) => el.isConnected)).toBe(true);
  await page.getByRole('button', { name: /^Inventory \d+/ }).click();
  await expect.poll(() => count(page)).toBe(3);
  const search = page.getByRole('textbox', { name: 'Search your business', exact: true });
  await search.fill('tee');
  await expect(search).toBeFocused();
  expect(await count(page)).toBe(3);
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await expect.poll(() => count(page)).toBe(4);
  await expect(search).toHaveValue('tee');
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await expect.poll(() => count(page)).toBe(5);
  const samples = await page.evaluate(() =>
    window.__motionSamples.map(({ animation, target }) => ({
      tag: target.tagName,
      duration: animation.effect!.getTiming().duration,
      frames: (animation.effect as KeyframeEffect).getKeyframes(),
    })),
  );
  expect(samples[0].tag).toBe('MAIN');
  for (const sample of samples) {
    expect(Number(sample.duration)).toBeGreaterThan(0);
    expect(Number(sample.duration)).toBeLessThanOrEqual(200);
    expect(Number(sample.frames[0].opacity)).toBeGreaterThanOrEqual(0.85);
    expect(sample.frames.every((frame) => !frame.transform && !frame.translate)).toBe(true);
  }
  await expect
    .poll(() =>
      page
        .locator('main')
        .evaluate(
          (el) =>
            el.getAnimations({ subtree: true }).filter((a) => a.id === 'content-transition').length,
        ),
    )
    .toBe(0);
  expect(await snapshot(page)).toBe(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('menus, dialogs and presses have subtle feedback while preserving layout, focus and dismissal', async ({
  page,
}) => {
  await page.goto('/demo');
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  const before = await snapshot(page);
  const trigger = page.getByRole('button', { name: 'Open profile menu', exact: true });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Your account' });
  expect(await menu.evaluate((el) => getComputedStyle(el).animationName)).toBe('menu-enter');
  await page.getByRole('menuitem', { name: 'Add profile photo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your profile', exact: true });
  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe('dialog-enter');
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(trigger).toBeFocused();
  const quick = page.getByRole('button', { name: 'Quick add', exact: true });
  const box = (await quick.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => quick.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
  await page.mouse.up();
  const popover = page.locator('.quick-menu');
  await expect(popover).toBeVisible();
  expect(await popover.evaluate((el) => getComputedStyle(el).animationName)).toBe('menu-enter');
  await quick.click();
  await expect(popover).toHaveCount(0);
  expect(await snapshot(page)).toBe(before);
});

test('reduced motion cancels a transition in progress and disables subsequent navigation and surface animation', async ({
  page,
}) => {
  await page.goto('/demo/inventory');
  await expect(page.getByRole('button', { name: /^Listings \d+/ })).toBeVisible();
  await page.evaluate(() => {
    window.__pauseMotion = true;
  });
  await page.getByRole('button', { name: /^Listings \d+/ }).click();
  await expect.poll(() => count(page)).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__motionSamples[0].animation.playState))
    .toBe('paused');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => window.__motionSamples[0].animation.playState))
    .toBe('idle');
  await page.getByRole('button', { name: /^Inventory \d+/ }).click();
  expect(await count(page)).toBe(1);
  await nav(page, 'Sales').click();
  await expect(page).toHaveURL(/\/demo\/sales$/);
  expect(await count(page)).toBe(1);
  await page.getByRole('button', { name: 'Open profile menu', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Your account' });
  expect(await menu.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('menuitem', { name: 'Add profile photo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your profile', exact: true });
  expect(await dialog.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
