import { test, expect, type Page } from '@playwright/test';
import { createBusinessTools } from '../../src/lib/assistant/business-tools';
import { workspaceSchema, type Workspace } from '../../src/lib/model';
import type { ChatResponse, ChatMessage } from '../../src/lib/assistant/chat-schema';
import { inventoryChange } from '../helpers/inventory-assistant';
const owner = '11111111-1111-4111-8111-111111111111';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
async function current(page: Page) {
  return workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
}
test.beforeEach(async ({ page, request }) => {
  await request.post(authOrigin + '/__reset');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
async function chat(
  page: Page,
  change: (message: string, w: Workspace) => ReturnType<typeof inventoryChange>,
  extra?: (
    tools: ReturnType<typeof createBusinessTools>,
    w: Workspace,
    message: string,
  ) => Promise<void>,
) {
  const messages: ChatMessage[] = [];
  let revision = 0,
    saved: ChatResponse | null = null;
  await page.route('**/api/assistant/extract', (r) =>
    r.fulfill({ json: { enabled: true, batchLimit: 10 } }),
  );
  await page.route('**/api/assistant/chat*', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          ready: true,
          enabled: true,
          model: 'gpt-6.1-sol',
          revision,
          messages,
          response: saved,
        },
      });
    const input = route.request().postDataJSON(),
      w = await current(page),
      action = change(input.message, w);
    const tools = createBusinessTools(w, input.drafts, input.message, null);
    for (const id of action.itemIds as string[])
      await tools.execute('get_record', { kind: 'item', id });
    await tools.execute('prepare_inventory_changes', { changes: [action] });
    if (extra) await extra(tools, w, input.message);
    saved = {
      message: 'Prepared the inventory change. Review and approve below; nothing has been saved.',
      choices: [],
      drafts: tools.drafts,
      model: 'gpt-6.1-sol',
      workspaceRevision: w.revision,
      tools: tools.trace,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    messages.push(
      { id: input.requestId, role: 'user', text: input.message },
      { id: crypto.randomUUID(), role: 'assistant', text: saved.message },
    );
    revision++;
    return route.fulfill({ json: { response: saved, revision } });
  });
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Refresh chat', exact: true }),
  ).toBeVisible();
}
async function send(page: Page, message: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Ask anything about your business…').fill(message);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
}
test('new inventory can be edited inline, saved through real approval once, and restored safely without changing other accounts', async ({
  page,
  request,
}) => {
  const before = await current(page),
    others = (await (await request.get(authOrigin + '/__metrics')).json()).workspaces;
  await chat(page, (message) => inventoryChange({ evidence: message }));
  await send(page, String(inventoryChange().evidence));
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Inventory proposal name', { exact: true });
  await expect(name).toHaveValue('Carhartt Detroit denim jacket');
  await expect(
    dialog.getByText('Acquisition date · assumed today, confirm or change', { exact: true }),
  ).toBeVisible();
  expect((await current(page)).items).toHaveLength(before.items.length);
  await name.fill('');
  await expect(dialog.getByRole('button', { name: 'Approve All (1)', exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Enter an item name.', { exact: true })).toBeVisible();
  await name.fill('Carhartt Detroit denim jacket');
  const cost = dialog.getByLabel('Inventory proposal purchase cost', { exact: true });
  await cost.fill('-1');
  await expect(cost).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('button', { name: 'Approve All (1)', exact: true })).toHaveCount(0);
  await cost.fill('3.');
  await expect(cost).toHaveValue('3.');
  await cost.fill('3');
  const approve = dialog.getByRole('button', { name: 'Approve All (1)', exact: true });
  await expect(approve).toBeEnabled();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await approve.click();
  await expect(dialog.getByText(/Saved 1 approved record/)).toBeVisible();
  const saved = await current(page);
  expect(saved.items).toHaveLength(before.items.length + 1);
  const item = saved.items.find((i) => i.title === 'Carhartt Detroit denim jacket')!;
  expect(item).toMatchObject({
    cost: 300,
    asking: 50000,
    status: 'Purchased',
    category: 'Jackets',
    brand: 'Carhartt',
  });
  expect(saved.orders).toEqual(before.orders);
  expect(saved.listings).toEqual(before.listings);
  const after = await (await request.get(authOrigin + '/__metrics')).json();
  expect(after.businessWrites).toBe(1);
  expect(after.workspaces['22222222-2222-4222-8222-222222222222']).toEqual(
    others['22222222-2222-4222-8222-222222222222'],
  );
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByLabel('Inventory proposal name', { exact: true }),
  ).toHaveCount(0);
  expect((await current(page)).items.filter((i) => i.id === item.id)).toHaveLength(1);
});
test('stage proposals update linked listings, require one consequential confirmation, and persist after reload', async ({
  page,
  request,
}) => {
  const before = await current(page),
    id = before.items[0].id;
  await chat(page, (message) =>
    inventoryChange({
      action: 'stage',
      itemIds: [id],
      evidence: message,
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: null,
      askingPrice: message.includes('unlisted') ? null : 3500,
      destination: message.includes('unlisted') ? 'unlisted' : 'for-sale',
      marketplace: message.includes('unlisted') ? null : 'Depop',
    }),
  );
  await send(page, 'Move the jacket to For Sale on Depop for 35');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Approve All (1)', exact: true })).toBeEnabled();
  await expect(
    dialog.getByRole('checkbox', { name: 'Confirm these linked record changes.', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Approve All (1)', exact: true }).click();
  await expect(dialog.getByText(/Saved 1 approved record/)).toBeVisible();
  let saved = await current(page);
  expect(saved.listings.find((l) => l.itemId === id)).toMatchObject({
    marketplace: 'Depop',
    price: 3500,
    status: 'Active',
  });
  expect(saved.items.find((i) => i.id === id)?.status).toBe('Listed');
  await send(page, 'Move the jacket back to unlisted');
  const confirmation = dialog.getByRole('checkbox', {
    name: 'Confirm these linked record changes.',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Approve All (1)', exact: true })).toHaveCount(0);
  await confirmation.check();
  await expect(dialog.getByRole('button', { name: 'Approve All (1)', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Approve All (1)', exact: true }).click();
  await expect
    .poll(async () => (await current(page)).listings.find((l) => l.itemId === id)?.status)
    .toBe('Ended');
  await page.reload();
  saved = await current(page);
  expect(saved.items.find((i) => i.id === id)?.status).toBe('Ready to List');
  expect(saved.orders).toEqual(before.orders);
  expect((await (await request.get(authOrigin + '/__metrics')).json()).businessWrites).toBe(2);
});

test('new physical inventory, actual sale and shipment share one approval and one atomic server commit', async ({
  page,
  request,
}) => {
  const { saleChange } = await import('../helpers/business-assistant');
  const { localDay } = await import('../../src/lib/dates');
  const before = await current(page);
  await chat(
    page,
    (message) =>
      inventoryChange({
        evidence: message,
        title: 'Bookshelf',
        category: 'Furniture',
        brand: null,
        source: null,
        askingPrice: null,
      }),
    async (tools, w) => {
      const id = tools.drafts.batch!.rows[0].inventoryChange!.itemId;
      await tools.execute('get_record', { kind: 'item', id });
      await tools.execute('prepare_changes', {
        changes: [
          saleChange(id, {
            identityEvidence: 'bookshelf',
            date: localDay(new Date(), w.settings.timezone),
            dateEvidence: 'today',
            fees: 200,
            processing: 0,
            shipping: 0,
            shippingCollected: 0,
            discount: 0,
            refund: 0,
            other: 0,
          }),
        ],
      });
      await tools.execute('prepare_inventory_changes', {
        changes: [
          inventoryChange({
            action: 'stage',
            itemIds: [id],
            evidence: 'shipped it today',
            title: null,
            brand: null,
            category: null,
            source: null,
            purchaseCost: null,
            askingPrice: null,
            destination: 'shipped',
          }),
        ],
      });
    },
  );
  await send(
    page,
    'I bought a bookshelf today for 3, sold it on Depop today for 35, fees 2 with no shipping received, refunds, discounts or other charges, and shipped it today',
  );
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Approve All (3)', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Text sale price', { exact: true })).toHaveValue('35');
  await expect(dialog.getByText('Choose an inventory item', { exact: true })).toHaveCount(0);
  expect((await current(page)).orders).toEqual(before.orders);
  await dialog.getByRole('button', { name: 'Approve All (3)', exact: true }).click();
  await expect(dialog.getByText(/Saved 3 approved record/)).toBeVisible();
  const saved = await current(page);
  expect(saved.items).toHaveLength(before.items.length + 1);
  expect(saved.orders).toHaveLength(1);
  expect(saved.orders[0].fulfillment).toBe('Shipped');
  expect(saved.orders[0].lines[0]).toMatchObject({ costBasis: 300, price: 3500 });
  expect((await (await request.get(authOrigin + '/__metrics')).json()).businessWrites).toBe(1);
});
test('a confirmed assistant purchase-cost correction persists a historical basis event while keeping the original sale intact', async ({
  page,
  request,
}) => {
  const { soldCostFixture } = await import('../helpers/purchase-costs');
  const { metrics } = await import('../../src/lib/finance');
  const original = await current(page),
    fixture = await soldCostFixture(1200),
    id = fixture.items[0].id;
  const seeded = await page.request.post('/api/workspace', {
    headers: { origin: new URL(page.url()).origin, 'x-thrift-user': owner },
    data: {
      revision: original.revision,
      commands: [
        { type: 'item', value: { ...fixture.items[0], status: 'Purchased' } },
        { type: 'order', value: fixture.orders[0] },
        { type: 'import', value: fixture.imports[0] },
      ],
    },
  });
  expect(seeded.ok()).toBe(true);
  const before = await current(page);
  await page.reload();
  await chat(page, (message) =>
    inventoryChange({
      action: 'cost',
      itemIds: [id],
      evidence: message,
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: 300,
      askingPrice: null,
    }),
  );
  await send(page, 'Correct the historical jacket purchase cost to 3');
  const dialog = page.getByRole('dialog');
  const confirmation = dialog.getByRole('checkbox', {
    name: /Confirm correcting recorded purchase costs/,
  });
  await expect(confirmation).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Approve All (1)', exact: true })).toHaveCount(0);
  expect((await current(page)).items.find((i) => i.id === id)?.cost).toBe(1200);
  await confirmation.check();
  await expect(dialog.getByRole('button', { name: 'Approve All (1)', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Approve All (1)', exact: true }).click();
  await expect(dialog.getByText(/Saved 1 approved record/)).toBeVisible();
  await page.reload();
  const saved = await current(page);
  expect(saved.items.find((i) => i.id === id)?.cost).toBe(300);
  expect(saved.orders).toEqual(before.orders);
  expect(saved.financialEvents.filter((e) => e.kind === 'Cost basis adjustment')).toHaveLength(1);
  expect(metrics(saved).profit - metrics(before).profit).toBe(900);
  expect((await (await request.get(authOrigin + '/__metrics')).json()).businessWrites).toBe(2);
});
