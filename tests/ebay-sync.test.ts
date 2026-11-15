import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), load: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => ({ adminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: mocks.load }));
import { runSync, firstCheckpoint } from '../src/lib/integrations/ebay/sync';
import { emptyWorkspace, type Workspace } from '../src/lib/model';
import { seal, unseal } from '../src/lib/integrations/ebay/crypto';
import { type StoredRecord, type Checkpoint } from '../src/lib/integrations/ebay/schema';
import { metrics } from '../src/lib/finance';
import { ebayOrder, ebayTransaction, ebayActor, ebaySeller, ebayAmount } from './helpers/ebay';
let w: Workspace,
  checkpoint: Checkpoint,
  records: Map<string, StoredRecord>,
  financials: boolean,
  financialError: string | null,
  cipher: string,
  disconnected: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated-sync-root');
  vi.stubEnv('EBAY_CLIENT_ID', 'client');
  vi.stubEnv('EBAY_CLIENT_SECRET', 'secret');
  vi.stubEnv('EBAY_REDIRECT_URI_NAME', 'runame');
  vi.stubEnv('EBAY_APP_URL', 'https://app.test');
  w = emptyWorkspace();
  checkpoint = firstCheckpoint('2026-11-10T00:00:00Z', new Date('2026-11-12T00:00:00Z'));
  records = new Map();
  financials = true;
  financialError = null;
  disconnected = false;
  cipher = seal(
    ebayActor,
    JSON.stringify({
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
      expiresAt: Date.now() + 7200000,
      scopes: ['scope-one', 'scope-two'],
    }),
  );
  mocks.load.mockImplementation(async () => structuredClone(w));
  mocks.rpc.mockImplementation(async (_name, args) => {
    const { p_action: a, p_data: d } = args;
    if (a === 'claim')
      return {
        data: disconnected
          ? null
          : {
              user_id: ebayActor,
              seller_id: ebaySeller,
              environment: 'production',
              financials,
              token_ciphertext: cipher,
              version: 'version',
              lease: 'lease',
              checkpoint,
              last_sync: '2026-11-10T00:00:00Z',
              last_financial_sync: '2026-11-10T00:00:00Z',
              financial_error: financialError,
            },
        error: null,
      };
    if (a === 'read')
      return {
        data: [...records.values()]
          .filter(
            (r) =>
              (!d.kind || r.kind === d.kind) &&
              (!d.ids || d.ids.includes(r.external_id)) &&
              (!d.orderId || (r.payload as { orderId?: string }).orderId === d.orderId) &&
              (!d.payoutId || (r.payload as { payoutId?: string }).payoutId === d.payoutId) &&
              (!d.state || r.state === d.state) &&
              (!d.resolved || Object.keys(r.resolution || {}).length),
          )
          .slice(0, d.limit || 200),
        error: null,
      };
    if (a === 'finish') {
      if (disconnected) return { data: null, error: { message: 'stale_sync_lease' } };
      if (d.revision !== w.revision) return { data: null, error: { message: 'revision_conflict' } };
      if (d.workspace) w = structuredClone(d.workspace);
      for (const r of d.records) records.set(`${r.kind}:${r.external_id}`, r);
      checkpoint = d.checkpoint;
      financialError = d.financial_error;
      if (d.token_ciphertext) cipher = d.token_ciphertext;
      return { data: { hasMore: d.more }, error: null };
    }
    return { data: { saved: true }, error: null };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith('/token'))
        return Response.json({
          access_token: 'refreshed-access',
          expires_in: 7200,
          token_type: 'Bearer',
        });
      if (u.pathname === '/sell/fulfillment/v1/order')
        return Response.json({
          orders: [
            {
              ...ebayOrder(),
              buyer: { email: 'PRIVATE_CUSTOMER' },
              fulfillmentStartInstructions: [
                { shippingStep: { shipTo: { fullName: 'PRIVATE_NAME' } } },
              ],
            },
          ],
          total: 1,
        });
      if (u.pathname === '/sell/finances/v1/transaction')
        return Response.json({ transactions: [ebayTransaction()], total: 1 });
      if (u.pathname === '/sell/finances/v1/payout')
        return Response.json({
          payouts: [
            {
              payoutId: 'payout-1',
              payoutDate: '2026-11-11T12:00:00Z',
              payoutStatus: 'SUCCEEDED',
              amount: ebayAmount('42.75'),
              transactionCount: 1,
              payoutInstrument: { accountLastFourDigits: 'PRIVATE_BANK' },
            },
          ],
          total: 1,
        });
      throw new Error('Unexpected endpoint');
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function cycle() {
  for (let i = 0; i < 100; i++) {
    const r = await runSync(ebayActor, true);
    if (!r.hasMore) return;
  }
  throw new Error('Sync did not finish');
}
it('imports owned canonical sales, fees and complete payouts over separate resumable phases, strips PII and repeats without duplication', async () => {
  await cycle();
  expect(w.orders).toHaveLength(1);
  expect(w.items).toHaveLength(1);
  expect(w.financialEvents).toHaveLength(1);
  expect(w.payouts).toHaveLength(1);
  expect(metrics(w)).toMatchObject({
    revenue: 4800,
    fees: 525,
    unknownFinancials: 0,
    unknownCosts: 1,
  });
  expect(JSON.stringify([...records.values()])).not.toMatch(
    /PRIVATE_CUSTOMER|PRIVATE_NAME|PRIVATE_BANK|private-access|private-refresh/,
  );
  const saved = structuredClone(w);
  await cycle();
  expect(w.orders).toEqual(saved.orders);
  expect(w.items).toEqual(saved.items);
  expect(w.financialEvents).toEqual(saved.financialEvents);
  expect(w.payouts).toEqual(saved.payouts);
});
it('orders-only access skips financial APIs and keeps unknown financial amounts visibly pending', async () => {
  financials = false;
  await cycle();
  expect(w.orders).toHaveLength(1);
  expect(metrics(w).unknownFinancials).toBe(1);
  expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/finances/'))).toBe(false);
});
it('financial permissions/signing failures do not block confirmed orders or pretend financial synchronization succeeded', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    String(args[0]).includes('/finances/')
      ? Response.json({ private: 'DO_NOT_EXPOSE' }, { status: 403 })
      : original(...args),
  );
  await cycle();
  expect(w.orders).toHaveLength(1);
  expect(financialError).toBe('finance');
  expect(metrics(w).unknownFinancials).toBe(1);
  expect(w.financialEvents).toHaveLength(0);
});
it('refreshes expired credentials under a sync lease and atomically preserves the reusable refresh grant', async () => {
  cipher = seal(
    ebayActor,
    JSON.stringify({
      accessToken: 'expired',
      refreshToken: 'existing-refresh',
      expiresAt: 1,
      scopes: ['one', 'two'],
    }),
  );
  await runSync(ebayActor, true);
  expect(JSON.parse(unseal(ebayActor, cipher))).toMatchObject({
    accessToken: 'refreshed-access',
    refreshToken: 'existing-refresh',
  });
  expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe('POST');
});
it('does not advance a failed provider page or follow arbitrary next URLs; retries use stable source mappings', async () => {
  const initial = structuredClone(checkpoint);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ private: 'bad' }, { status: 401 }));
  await expect(runSync(ebayActor, true)).rejects.toThrow('expired');
  expect(checkpoint).toEqual(initial);
  expect(w.orders).toHaveLength(0);
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ orders: [ebayOrder()], next: 'https://attacker.test/steal' }),
  );
  await runSync(ebayActor, true);
  expect(checkpoint.offset).toBe(1);
  expect(vi.mocked(fetch).mock.calls.every(([u]) => !String(u).includes('attacker.test'))).toBe(
    true,
  );
});
it('does not commit after disconnect and retains canonical source transactions on revision conflicts', async () => {
  const original = mocks.load.getMockImplementation()!;
  mocks.load.mockImplementationOnce(async () => {
    disconnected = true;
    return original();
  });
  await expect(runSync(ebayActor, true)).rejects.toThrow('Another save');
  expect(w.orders).toHaveLength(0);
  expect(records.size).toBe(0);
});
it('initial history covers accessible two-year windows and pagination never jumps over source pages', async () => {
  checkpoint = firstCheckpoint(null, new Date('2026-11-12T00:00:00Z'));
  financials = false;
  const start = checkpoint.from,
    end = checkpoint.end;
  await cycle();
  expect(checkpoint.phase).toBe('done');
  const filters = vi
    .mocked(fetch)
    .mock.calls.map(([u]) => new URL(String(u)).searchParams.get('filter') || '');
  expect(filters[0]).toContain(start);
  expect(filters.at(-1)).toContain(end);
  expect(filters.length).toBeGreaterThan(20);
  expect(w.orders).toHaveLength(1);
});

it('keeps financial history independent so later permission approval backfills old charges rather than only recent orders', async () => {
  const original = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1].p_action === 'claim' && result.data) result.data.last_financial_sync = null;
    return result;
  });
  await runSync(ebayActor, true);
  expect(checkpoint.phase).toBe('transactions');
  expect(Date.parse(checkpoint.from)).toBeLessThan(Date.parse('2025-01-01T00:00:00Z'));
});
