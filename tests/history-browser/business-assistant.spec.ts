import { test, expect } from '@playwright/test';
import { createBusinessTools } from '../../src/lib/assistant/business-tools';
import { workspaceSchema, type Workspace } from '../../src/lib/model';
import { saleChange, emptyDrafts } from '../helpers/business-assistant';
import type { ChatMessage, ChatResponse } from '../../src/lib/assistant/chat-schema';
const owner = '11111111-1111-4111-8111-111111111111';
const authOrigin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_HISTORY_PORT || 3181) + 1}`;
test.beforeEach(async ({ request, page }) => {
  expect((await request.post(`${authOrigin}/__reset`)).ok()).toBe(true);
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Owner123');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
});
test('natural sale proposals stay private and unsaved until one approval, retain partial money input, and recover after reload on mobile/desktop', async ({
  page,
  request,
}) => {
  const w: Workspace = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  let revision = 0,
    messages: ChatMessage[] = [],
    saved: ChatResponse | null = null;
  await page.route('**/api/assistant/extract', (route) =>
    route.fulfill({ json: { enabled: true, batchLimit: 10 } }),
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
    const input = route.request().postDataJSON();
    const tools = createBusinessTools(w, input.drafts, input.message, null);
    await tools.execute('get_record', { kind: 'item', id: w.items[0].id });
    await tools.execute('prepare_changes', {
      changes: [saleChange(w.items[0].id, { identityEvidence: 'jacket' })],
    });
    saved = {
      message:
        'I found your jacket. When did it sell, and what were the seller fees? Review below before saving.',
      choices: [],
      drafts: tools.drafts,
      model: 'gpt-6.1-sol',
      workspaceRevision: w.revision,
      tools: tools.trace,
      usage: { inputTokens: 100, outputTokens: 20 },
    };
    messages = [
      { id: input.requestId, role: 'user', text: input.message },
      { id: crypto.randomUUID(), role: 'assistant', text: saved.message },
    ];
    return route.fulfill({ json: { revision: ++revision, response: saved } });
  });
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Refresh chat', exact: true })).toBeVisible();
  await dialog.locator('textarea').fill('I sold my jacket on Depop for thirty five dollars.');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByLabel('Text sale price', { exact: true })).toHaveValue('35');
  await expect(dialog.getByLabel('Text sale date', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Text seller fees', { exact: true })).toHaveValue('');
  expect((await (await request.get(`${authOrigin}/__metrics`)).json()).businessWrites).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/I found your jacket/)).toBeVisible();
  await expect(dialog.getByLabel('Text sale price', { exact: true })).toHaveValue('35');
  const price = dialog.getByLabel('Text sale price', { exact: true });
  await price.fill('35.');
  await expect(price).toHaveValue('35.');
  await price.fill('35.50');
  await dialog.getByLabel('Text sale date', { exact: true }).fill('2026-11-12');
  await dialog.getByLabel('Text seller fees', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'No other selling amounts ($0)', exact: true }).click();
  const approve = dialog.getByRole('button', { name: 'Approve All (1)', exact: true });
  await expect(approve).toBeEnabled();
  await expect(dialog.getByText('Validated profit: $23.50', { exact: true })).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await approve.click();
  await expect(dialog.getByText(/Saved 1 approved record/)).toBeVisible();
  const savedW = workspaceSchema.parse(
    await (
      await page.request.get('/api/workspace', { headers: { 'x-thrift-user': owner } })
    ).json(),
  );
  expect(savedW.items).toHaveLength(w.items.length);
  expect(savedW.orders).toHaveLength(1);
  expect(savedW.orders[0].lines[0]).toMatchObject({
    itemId: w.items[0].id,
    price: 3550,
    costBasis: 1200,
  });
  expect((await (await request.get(`${authOrigin}/__metrics`)).json()).businessWrites).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Refresh chat', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Text sale price', { exact: true })).toHaveCount(0);
  expect((await (await request.get(`${authOrigin}/__metrics`)).json()).businessWrites).toBe(1);
});

test('private attachment questions retry safely, preserve source context after reload and recover a lost turn response', async ({
  page,
  request,
}) => {
  let uploaded = 0,
    posted = 0,
    revision = 0;
  const fileId = crypto.randomUUID();
  let files: { id: string; name: string; mime: string }[] = [],
    messages: ChatMessage[] = [];
  await page.route('**/api/assistant/extract', (route) =>
    route.fulfill({ json: { enabled: true, batchLimit: 10 } }),
  );
  await page.route('**/api/assistant/files', (route) => {
    uploaded++;
    const body = route.request().postDataBuffer()!.toString();
    const match = body.match(/name="id"\r\n\r\n([a-f0-9-]+)/);
    files = [{ id: match?.[1] || fileId, name: 'notes.csv', mime: 'text/csv' }];
    return route.fulfill({ json: { file: files[0] } });
  });
  await page.route('**/api/assistant/chat*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          ready: true,
          enabled: true,
          model: 'gpt-6.1-sol',
          revision,
          messages,
          response: null,
        },
      });
    const input = route.request().postDataJSON();
    expect(input.fileIds).toEqual(files.map((f) => f.id));
    posted++;
    if (posted === 1)
      return route.fulfill({
        status: 502,
        json: {
          error: 'Connection interrupted. Retry your message; business records are unchanged.',
        },
      });
    const response = {
      message: 'This CSV contains one item, a tee at $35.00. No records were prepared or saved.',
      choices: [],
      drafts: emptyDrafts,
      model: 'gpt-6.1-sol',
      workspaceRevision: 0,
      tools: ['read_attachment'],
      usage: { inputTokens: 100, outputTokens: 20 },
    };
    messages = [
      { id: input.requestId, role: 'user', text: input.message, files },
      { id: crypto.randomUUID(), role: 'assistant', text: response.message },
    ];
    return route.fulfill({ json: { revision: ++revision, response, replayed: true } });
  });
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Refresh chat', exact: true })).toBeVisible();
  await dialog.getByLabel('Import files').setInputFiles({
    name: 'notes.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Item,Price\nTee,35'),
  });
  await dialog.locator('textarea').fill('What is in this file?');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Connection interrupted');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByText(/This CSV contains one item/)).toBeVisible();
  expect(uploaded).toBe(2); // Same source UUID makes server upload retry idempotent.
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  expect((await (await request.get(`${authOrigin}/__metrics`)).json()).businessWrites).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('.assistant-document')).toContainText('notes.csv');
  await expect(dialog.getByText(/This CSV contains one item/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Approve All/ })).toHaveCount(0);
});

test('mobile clarification choices send the selected physical item and clearing chat never commits business records', async ({
  page,
  request,
}) => {
  const selectedId = '44444444-4444-4444-8444-444444444444';
  let calls = 0,
    cleared = false;
  await page.route('**/api/assistant/extract', (route) =>
    route.fulfill({ json: { enabled: true, batchLimit: 10 } }),
  );
  await page.route('**/api/assistant/chat*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          ready: true,
          enabled: true,
          model: 'gpt-6.1-sol',
          revision: 0,
          messages: [],
          response: null,
        },
      });
    if (route.request().method() === 'DELETE') {
      cleared = true;
      return route.fulfill({
        json: { revision: 3, messages: [], response: null, attachmentsCleared: true },
      });
    }
    const input = route.request().postDataJSON();
    calls++;
    if (calls === 2) expect(input.selectedItemId).toBe(selectedId);
    return route.fulfill({
      json: {
        revision: calls,
        response: {
          message:
            calls === 1
              ? 'Which physical item did you mean?'
              : 'I will use the owner jacket. What happened to it?',
          choices:
            calls === 1
              ? [
                  {
                    itemId: selectedId,
                    label: 'Owner private jacket · RETAINED-1',
                    text: 'Use inventory RETAINED-1: Owner private jacket.',
                  },
                ]
              : [],
          drafts: emptyDrafts,
          model: 'gpt-6.1-sol',
          workspaceRevision: 0,
          tools: ['search_inventory'],
          usage: { inputTokens: 100, outputTokens: 20 },
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Refresh chat', exact: true })).toBeVisible();
  await dialog.locator('textarea').fill('Can you help with my jacket?');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  const choice = dialog.getByRole('button', {
    name: 'Owner private jacket · RETAINED-1',
    exact: true,
  });
  await expect(choice).toBeVisible();
  expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await choice.click();
  await expect(
    dialog.getByText('I will use the owner jacket. What happened to it?', { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(2);
  page.once('dialog', (dialog) => dialog.accept());
  await dialog.getByRole('button', { name: 'Clear chat', exact: true }).click();
  await expect(
    dialog.getByText('I will use the owner jacket. What happened to it?', { exact: true }),
  ).toHaveCount(0);
  expect(cleared).toBe(true);
  expect((await (await request.get(`${authOrigin}/__metrics`)).json()).businessWrites).toBe(0);
});
