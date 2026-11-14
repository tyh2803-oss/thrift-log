'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { purchaseCostCommands, inventoryCostKnown, type PurchaseCosts } from '@/lib/purchase-costs';
import { allocate, money } from '@/lib/money';
import { listingAmount } from '@/lib/assistant/listing-review';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { FormSaveBar } from './form-save-bar';
export function BulkPurchaseCosts({
  itemIds,
  onClose,
  onSaved,
}: {
  itemIds: string[];
  onClose: () => void;
  onSaved?: (ids: string[]) => void;
}) {
  const { w, demo, dispatch, refresh, requestHeaders, notify } = useWorkspace();
  const items = [...new Set(itemIds)].flatMap((id) => {
    const item = w.items.find((i) => i.id === id);
    return item ? [item] : [];
  });
  const [id] = useState(() => crypto.randomUUID()),
    [selected, setSelected] = useState(() =>
      items
        .filter((i) => !inventoryCostKnown(w, i.id))
        .slice(0, 200)
        .map((i) => i.id),
    ),
    [mode, setMode] = useState('same'),
    [raw, setRaw] = useState(''),
    [overrides, setOverrides] = useState<Record<string, string>>({}),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saleCostsReady, setSaleCostsReady] = useState<boolean | null>(demo ? true : null),
    [setupError, setSetupError] = useState('');
  const checkSetup = useCallback(
    async (signal?: AbortSignal) => {
      if (demo) return;
      try {
        const response = await fetch('/api/purchase-costs', {
          headers: requestHeaders,
          cache: 'no-store',
          signal,
        });
        const data = await response.json();
        if (!response.ok || typeof data.savedSaleCosts !== 'boolean')
          throw new Error(data.error || 'Unable to check purchase-cost setup.');
        if (!signal?.aborted) {
          setSaleCostsReady(data.savedSaleCosts);
          setSetupError('');
        }
      } catch (e) {
        if (!signal?.aborted)
          setSetupError(e instanceof Error ? e.message : 'Unable to check purchase-cost setup.');
      }
    },
    [demo, requestHeaders],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void checkSetup(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [checkSetup]);
  const lock = useRef(false);
  const chosen = items.filter((i) => selected.includes(i.id)),
    amount = listingAmount(raw),
    values =
      amount.value !== null && !amount.error
        ? mode === 'split'
          ? allocate(
              amount.value,
              chosen.map(() => 1),
            )
          : chosen.map(() => amount.value!)
        : [];
  const entries = chosen.map((item, index) => ({
    itemId: item.id,
    ...listingAmount(
      overrides[item.id] ??
        (mode === 'individual'
          ? ''
          : values[index] === undefined
            ? ''
            : (values[index] / 100).toFixed(2)),
    ),
  }));
  const valid =
    entries.length > 0 &&
    entries.length <= 200 &&
    entries.every((e) => e.value !== null && !e.error);
  const saleCount = w.orders.filter((o) => o.lines.some((l) => selected.includes(l.itemId))).length;
  const canSave = valid && (!saleCount || saleCostsReady === true);
  const selectedTotal = valid
    ? money(entries.reduce((sum, e) => sum + e.value!, 0))
    : 'Enter valid costs';
  async function save() {
    if (lock.current || !canSave) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const batch: PurchaseCosts = {
        id,
        entries: entries.map((e) => ({ itemId: e.itemId, cost: e.value! })),
        confirmCorrections: confirm,
        reason: 'Explicit bulk purchase cost review',
      };
      if (demo) {
        const commands = purchaseCostCommands(w, batch);
        if (commands.length && !(await dispatch(commands)))
          throw new Error('Purchase costs were not saved.');
      } else {
        const response = await fetch('/api/purchase-costs', {
          method: 'POST',
          headers: { ...requestHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: w.revision, batch }),
        });
        const data = await response.json();
        if (data.code === 'purchase_cost_setup_required') setSaleCostsReady(false);
        if (!response.ok)
          throw new Error(
            data.error || 'The cost batch was not confirmed. Refresh before retrying.',
          );
        await refresh();
      }
      notify(`Purchase costs saved for ${entries.length} physical items.`);
      onSaved?.(batch.entries.map((e) => e.itemId));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save this cost batch.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Bulk purchase costs"
      description="One cost per physical item, including cross-listings. Nothing changes until you apply."
      wide
    >
      <div className="padded bulk-purchase-costs">
        <FormSaveBar
          summary={
            <strong>
              {selectedTotal} · {entries.length} selected
            </strong>
          }
          label={`Save Changes (${entries.length})`}
          accessibleLabel="Save purchase costs at top"
          disabled={!canSave}
          busy={busy}
          onSave={() => void save()}
        />
        {!!saleCount && saleCostsReady !== true && (
          <div className="cost-setup-notice" role="status">
            <p>
              {setupError ||
                (saleCostsReady === null
                  ? 'Checking saved-sale purchase-cost setup…'
                  : 'Purchase-cost updates for saved sales need a one-time administrator setup. Your entries stay here until it is ready.')}
            </p>
            <Button variant="outline" disabled={busy} onClick={() => void checkSetup()}>
              Check setup again
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="error-box cost-save-error">
            <p>{error}</p>
            <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
              Refresh records
            </Button>
          </div>
        )}
        <p>
          {items.length} matching physical items · {chosen.length} selected. Apply up to 200 at a
          time.
        </p>
        <div className="actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setSelected(
                items
                  .filter((i) => confirm || !inventoryCostKnown(w, i.id))
                  .slice(0, 200)
                  .map((i) => i.id),
              )
            }
          >
            Select {items.length > 200 ? 'first 200 eligible' : 'all eligible'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            disabled={busy}
            checked={confirm}
            onChange={(e) => {
              setConfirm(e.target.checked);
              if (!e.target.checked)
                setSelected((old) => old.filter((id) => !inventoryCostKnown(w, id)));
            }}
          />
          Allow corrections to recorded purchase costs
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Cost entry</span>
            <select
              aria-label="Cost entry"
              disabled={busy}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="same">Same cost per item</option>
              <option value="split">Split total cost</option>
              <option value="individual">Individual costs</option>
            </select>
          </label>
          {mode !== 'individual' && (
            <label className="field">
              <span>
                {mode === 'split' ? 'Total purchase cost ($)' : 'Purchase cost per item ($)'}
              </span>
              <input
                aria-label="Batch purchase amount"
                inputMode="decimal"
                placeholder="Unknown"
                disabled={busy}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            </label>
          )}
        </div>
        <p className="hint">
          Unknown is different from confirmed $0. Individual overrides stay in place when switching
          cost modes.
        </p>
        <div className="bulk-cost-items">
          {items.map((item) => {
            const selectedIndex = chosen.findIndex((i) => i.id === item.id),
              value = entries[selectedIndex];
            return (
              <div className="bulk-cost-item" key={item.id}>
                <label className="check-row">
                  <input
                    aria-label={`Select cost for ${item.title}`}
                    type="checkbox"
                    disabled={busy || (!confirm && inventoryCostKnown(w, item.id))}
                    checked={selected.includes(item.id)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.sku} ·{' '}
                      {inventoryCostKnown(w, item.id)
                        ? `${money(item.cost)} recorded`
                        : 'Purchase cost unknown'}
                    </small>
                  </span>
                </label>
                <label className="field">
                  <span className="sr-only">{`Purchase cost for ${item.title}`}</span>
                  <input
                    aria-label={`Purchase cost for ${item.title}`}
                    inputMode="decimal"
                    placeholder="Unknown"
                    disabled={busy || selectedIndex < 0}
                    value={
                      overrides[item.id] ??
                      (mode === 'individual'
                        ? ''
                        : values[selectedIndex] === undefined
                          ? ''
                          : (values[selectedIndex] / 100).toFixed(2))
                    }
                    onChange={(e) => setOverrides((old) => ({ ...old, [item.id]: e.target.value }))}
                  />
                </label>
                {value?.error && (
                  <small className="error-text bulk-cost-error">{value.error}</small>
                )}
              </div>
            );
          })}
        </div>
        {!!saleCount && (
          <p className="hint">
            {saleCount} saved sales are affected. Original sale lines are retained; purchase-cost
            corrections use their original sale dates. Revenue, seller fees and payouts stay
            unchanged. Returns retain the correct cost reversal.
          </p>
        )}
        <div className="actions">
          <strong>
            {valid ? money(entries.reduce((sum, e) => sum + e.value!, 0)) : 'Enter valid costs'} ·{' '}
            {entries.length} physical items
          </strong>
          <Button disabled={busy || !canSave} onClick={() => void save()}>
            {busy ? 'Saving costs…' : `Apply purchase costs (${entries.length})`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
