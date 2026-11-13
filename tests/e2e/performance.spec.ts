import { test, expect } from '@playwright/test';
import { emptyWorkspace } from '../../src/lib/model';

test('idle screens stop recalculating every second while live timers still track pauses and background time accurately', async ({
  page,
}) => {
  await page.goto('/demo');
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  await page.evaluate(
    (w) => localStorage.setItem('thrift-log.demo.v1', JSON.stringify(w)),
    emptyWorkspace(),
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.runFor(150);
  await page.evaluate(() => {
    const stats = { formats: 0 };
    (window as unknown as { __clockStats: typeof stats }).__clockStats = stats;
    Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
      construct(target, args, newTarget) {
        stats.formats++;
        return Reflect.construct(target, args, newTarget);
      },
    });
  });
  await page.clock.fastForward(5000);
  expect(
    await page.evaluate(
      () => (window as unknown as { __clockStats: { formats: number } }).__clockStats.formats,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Quick add', exact: true }).click();
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Buying', exact: true }).click();
  await expect(page.getByText('Buying timer started.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  const timer = page.getByRole('region', { name: 'Active timer', exact: true });
  await expect(timer).toContainText('0h 00m tracked');
  await page.clock.fastForward(61000);
  await expect(timer).toContainText('0h 01m tracked');
  await page.getByRole('button', { name: 'Pause timer', exact: true }).click();
  await expect(timer).toContainText('paused');
  await page.clock.fastForward(120000);
  await expect(timer).toContainText('0h 01m tracked');
  await page.getByRole('button', { name: 'Resume timer', exact: true }).click();
  await page.clock.fastForward(60000);
  await expect(timer).toContainText('0h 02m tracked');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(120000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(timer).toContainText('0h 04m tracked');
  await page.getByRole('button', { name: 'End timer', exact: true }).click();
  await expect(timer).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('thrift-log.demo.v1')!));
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0].state).toBe('Ended');
  expect(saved.sessions[0].segments).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
