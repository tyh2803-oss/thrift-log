import { expect, test, type Page } from '@playwright/test';
import { emptyWorkspace, expenseSchema } from '../../src/lib/model';
const key = 'thrift-log.demo.v1';
async function token(page: Page, name: string, background = false) {
  return page.evaluate(
    ({ name, background }) => {
      const el = document.createElement('span');
      if (background) el.style.backgroundColor = `var(${name})`;
      else el.style.color = `var(${name})`;
      document.body.append(el);
      const value = background ? getComputedStyle(el).backgroundColor : getComputedStyle(el).color;
      el.remove();
      return value;
    },
    { name, background },
  );
}
function contrast(a: string, b: string) {
  const luminance = (s: string) =>
    s
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => (n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test('financial controls use clear colors and icons without changing stored business data or lifecycle colors', async ({
  page,
}) => {
  await page.goto('/demo');
  const pipeline = page.getByRole('region', { name: 'Inventory Pipeline', exact: true });
  await expect(pipeline).toBeVisible();
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  const stageColor = await pipeline
    .locator('.pipeline-for-sale .pipeline-stage-title')
    .evaluate((el) => getComputedStyle(el).color);
  for (const [label, tone] of [
    ['Cost', 'cost'],
    ['Profit', 'profit'],
    ['Sale Value', 'revenue'],
  ] as const) {
    const button = pipeline.getByRole('button', { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button.locator('svg')).toHaveCount(1);
    await expect(pipeline).toHaveAttribute('data-metric', tone);
    await expect
      .poll(() =>
        pipeline
          .locator('.pipeline-money')
          .first()
          .evaluate((el) => getComputedStyle(el).color),
      )
      .toBe(await token(page, `--color-${tone}`));
    expect(
      await pipeline
        .locator('.pipeline-for-sale .pipeline-stage-title')
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe(stageColor);
  }
  const chart = page.locator('.chart-card');
  for (const label of ['Revenue', 'Profit']) {
    await chart.getByRole('button', { name: label, exact: true }).click();
    await expect(chart).toHaveAttribute('data-metric', label.toLowerCase());
    await expect(chart.locator('.recharts-area-curve')).toHaveAttribute(
      'stroke',
      'var(--metric-color)',
    );
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(before);
  await expect(page.locator('.dashboard-metrics .metric').first()).toHaveAttribute(
    'data-metric',
    'revenue',
  );
  await expect(page.locator('.dashboard-metrics .metric').nth(1)).toHaveAttribute(
    'data-metric',
    'profit',
  );
  await expect(page.locator('.timer-dock')).toHaveCount(0);
});
test('functional colors and secondary text meet contrast in both themes, with reduced motion and visible focus', async ({
  page,
}) => {
  await page.goto('/demo');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.goto('/demo/settings');
      await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
      await page.goto('/demo');
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const meaning of ['cost', 'revenue', 'profit', 'warning', 'error', 'complete'])
      expect(
        contrast(
          await token(page, `--color-${meaning}`),
          await token(page, `--color-${meaning}-soft`, true),
        ),
        `${theme} ${meaning}`,
      ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(await token(page, '--muted'), await token(page, '--card', true)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(await token(page, '--action-text'), await token(page, '--action', true)),
    ).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: test.info().outputPath(`dashboard-${theme}.png`),
      fullPage: true,
    });
    await page.goto('/demo/insights');
    await expect(page.locator('.recharts-cartesian-axis-tick-value').first()).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.recharts-cartesian-axis-tick-value')
          .first()
          .evaluate((el) => getComputedStyle(el).fill),
      )
      .toBe(await token(page, '--muted'));
  }
  await page.goto('/demo');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const control = page
    .getByRole('group', { name: 'Pipeline metric' })
    .getByRole('button', { name: 'Cost', exact: true });
  await control.focus();
  await expect(control).toHaveCSS('outline-style', 'solid');
  await expect(control).toHaveCSS('transition-duration', '0s');
});
test('losses remain red and the empty workspace works on narrow phones without the floating timer', async ({
  page,
}) => {
  await page.goto('/demo');
  const w = emptyWorkspace();
  w.expenses = [
    expenseSchema.parse({
      id: crypto.randomUUID(),
      title: 'Operating expense',
      amount: 1000,
      category: 'Supplies',
      date: new Date().toISOString(),
    }),
  ];
  await page.evaluate(({ key, w }) => localStorage.setItem(key, JSON.stringify(w)), { key, w });
  await page.reload();
  const profit = page.locator('.dashboard-metrics .metric').nth(1).locator('strong');
  await expect(profit).toHaveText('-$10.00');
  await expect
    .poll(() => profit.evaluate((el) => getComputedStyle(el).color))
    .toBe(await token(page, '--color-error'));
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `viewport ${width}`,
    ).toBe(true);
    await expect(page.locator('.timer-dock')).toHaveCount(0);
    const nav = await page.locator('.mobile-nav').boundingBox();
    const assistant = await page
      .getByRole('button', { name: 'Open AI assistant', exact: true })
      .boundingBox();
    expect(assistant!.y + assistant!.height).toBeLessThanOrEqual(nav!.y);
    for (const button of await page
      .getByRole('group', { name: 'Pipeline metric' })
      .getByRole('button')
      .all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: test.info().outputPath('empty-phone.png'), fullPage: true });
});

test('marketplace filters use distinct accessible colors on mobile and desktop in both themes', async ({
  page,
}) => {
  await page.goto('/demo/inventory');
  const select = page.getByRole('combobox', { name: 'Filter marketplace', exact: true });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.goto('/demo/settings');
      await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
      await page.goto('/demo/inventory');
    }
    for (const [marketplace, tone] of [
      ['Depop', 'depop'],
      ['Whatnot', 'whatnot'],
      ['Vinted', 'vinted'],
      ['eBay', 'ebay'],
      ['In person', 'in-person'],
    ]) {
      await select.selectOption(marketplace);
      await expect(select).toHaveValue(marketplace);
      const style = await select.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          color: s.color,
          background: s.backgroundColor,
          height: el.getBoundingClientRect().height,
        };
      });
      expect(style.color).toBe(await token(page, `--marketplace-${tone}`));
      expect(style.background).toBe(await token(page, `--marketplace-${tone}-soft`, true));
      expect(
        contrast(style.color, style.background),
        `${theme} ${marketplace}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(style.height).toBeGreaterThanOrEqual(44);
    }
    await select.selectOption('All marketplaces');
    expect(await select.evaluate((el) => getComputedStyle(el).color)).toBe(
      await token(page, '--text'),
    );
    await select.selectOption('Depop');
    await select.focus();
    expect(await select.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`marketplace-${theme}.png`),
      fullPage: true,
    });
  }
  await page.goto('/demo/sales');
  await select.selectOption('Whatnot');
  expect(await select.evaluate((el) => getComputedStyle(el).color)).toBe(
    await token(page, '--marketplace-whatnot'),
  );
});

test('home keeps primary finances and pipeline visible while optional planning expands on demand without losing information', async ({
  page,
}) => {
  await page.goto('/demo');
  await expect(page.locator('.dashboard-metrics .metric')).toHaveCount(2);
  await expect(page.getByLabel('Time and productivity')).toContainText('Time invested');
  await expect(page.getByRole('region', { name: 'Inventory Pipeline', exact: true })).toBeVisible();
  const more = page.locator('details.home-secondary');
  await expect(more).not.toHaveAttribute('open', '');
  await expect(
    page.getByRole('heading', { name: 'Monthly profit goal', exact: true }),
  ).not.toBeVisible();
  await more.locator(':scope > summary').click();
  await expect(
    page.getByRole('heading', { name: 'Monthly profit goal', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Where your sales happen', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('home-simplified.png'), fullPage: true });
});
