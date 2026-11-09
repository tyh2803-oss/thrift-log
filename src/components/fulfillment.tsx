'use client';
import { useState, type FormEvent } from 'react';
import { Plus, Download } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import {
  marketplaces,
  payoutSchema,
  shipmentSchema,
  type Payout,
  type Shipment,
  type Command,
} from '@/lib/model';
import { currentOrderTotals, paidForOrder, payoutReceived, returnedItemIds } from '@/lib/ledger';
import { money, parseMoney, allocate } from '@/lib/finance';
import { downloadCsv } from '@/lib/csv';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Field } from './editor';
import { Empty, Status, Badge } from './shared';
const localDate = (value?: string) => {
  const d = value ? new Date(value) : new Date();
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function Fulfillment({
  kind,
  range,
  search,
}: {
  kind: 'Payouts' | 'Shipments';
  range: [number, number];
  search: string;
}) {
  const { w, dispatch, saving, notify, error } = useWorkspace();
  const [editing, setEditing] = useState<Shipment | true | null>(null);
  const payouts = w.payouts
    .filter(
      (p) =>
        +new Date(p.date) >= range[0] &&
        +new Date(p.date) <= range[1] &&
        `${p.reference} ${p.marketplace} ${p.notes}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const shipments = w.shipments.filter(
    (p) =>
      +new Date(p.date) >= range[0] &&
      +new Date(p.date) <= range[1] &&
      `${p.tracking} ${p.carrier} ${p.marketplace} ${p.notes}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function reverse(p: Payout) {
    if (
      !window.confirm(
        'Record an equal and opposite payout receipt today? The original remains in the audit trail.',
      )
    )
      return;
    const reversal = {
      ...p,
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      reference: `Reversal: ${p.reference}`,
      reversalOf: p.id,
    };
    if (await dispatch({ type: 'payout', value: reversal })) notify('Payout reversal recorded.');
  }
  return (
    <>
      <div className="page-toolbar">
        <p className="muted">
          {kind === 'Payouts'
            ? `${money(payoutReceived(w, ...range))} net cash receipts in this period · receipts do not create profit`
            : 'One package may contain several orders. Label costs are counted only when explicitly allocated.'}
        </p>
        <div className="actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                kind.toLowerCase(),
                kind === 'Payouts'
                  ? payouts.map((p) => ({
                      id: p.id,
                      date: p.date,
                      marketplace: p.marketplace,
                      reference: p.reference,
                      amount: (p.reversalOf ? -p.amount : p.amount) / 100,
                      allocations: JSON.stringify(p.allocations),
                      reversal_of: p.reversalOf,
                    }))
                  : shipments.map((s) => ({
                      ...s,
                      labelCost: s.labelCost / 100,
                      orderIds: s.orderIds.join('|'),
                    })),
              )
            }
          >
            <Download size={15} />
            Export
          </Button>
          <Button size="sm" onClick={() => setEditing(true)}>
            <Plus size={15} />
            {kind === 'Payouts' ? 'Record payout' : 'Create package'}
          </Button>
        </div>
      </div>
      <section className="card">
        {kind === 'Payouts' ? (
          payouts.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Marketplace</th>
                    <th>Date</th>
                    <th>Orders</th>
                    <th>Cash</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.reference}</strong>
                        <small className="block muted">{p.notes}</small>
                      </td>
                      <td>{p.marketplace}</td>
                      <td>{new Date(p.date).toLocaleDateString()}</td>
                      <td>{p.allocations.length}</td>
                      <td className={p.reversalOf ? 'negative' : 'positive'}>
                        {money(p.reversalOf ? -p.amount : p.amount)}
                      </td>
                      <td>
                        {p.reversalOf ? (
                          <Badge>Reversal</Badge>
                        ) : w.payouts.some((r) => r.reversalOf === p.id) ? (
                          <Badge>Reversed</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={saving}
                            onClick={() => void reverse(p)}
                          >
                            Reverse
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="A place for actual payouts"
              description="Record the cash received and allocate it to the orders it settles. Manual Paid flags are not bank receipts."
              action={<Button onClick={() => setEditing(true)}>Record payout</Button>}
            />
          )
        ) : shipments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Marketplace</th>
                  <th>Orders</th>
                  <th>Label cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button className="cell-button" onClick={() => setEditing(s)}>
                        <strong>
                          {s.carrier || 'Package'} · {s.tracking || 'No tracking yet'}
                        </strong>
                        <small>
                          {new Date(s.date).toLocaleDateString()} · {s.notes}
                        </small>
                      </button>
                    </td>
                    <td>{s.marketplace}</td>
                    <td>{s.orderIds.length}</td>
                    <td>
                      {money(s.labelCost)}{' '}
                      {s.allocatedShipping && <Badge tone="green">Allocated</Badge>}
                    </td>
                    <td>
                      <Status value={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Several orders. One package."
            description="Group orders, track shipment progress, and split a label cost once when needed."
            action={<Button onClick={() => setEditing(true)}>Create package</Button>}
          />
        )}
      </section>
      {editing && (
        <OperationEditor
          kind={kind}
          shipment={editing === true ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}{' '}
      {error && <p className="error-text">{error}</p>}
    </>
  );
}
function OperationEditor({
  kind,
  shipment,
  onClose,
}: {
  kind: 'Payouts' | 'Shipments';
  shipment?: Shipment;
  onClose: () => void;
}) {
  const { w, dispatch, saving, error: workspaceError, notify } = useWorkspace();
  const [initialDate] = useState(() => localDate(shipment?.date));
  const [id] = useState(() => shipment?.id || crypto.randomUUID());
  const [market, setMarket] = useState(shipment?.marketplace || 'Whatnot');
  const [selected, setSelected] = useState<string[]>(shipment?.orderIds || []);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [label, setLabel] = useState(String((shipment?.labelCost || 0) / 100));
  const orders = w.orders.filter(
    (o) =>
      o.marketplace === market &&
      o.status === 'Completed' &&
      (kind === 'Payouts' ||
        ((shipment?.orderIds.includes(o.id) ||
          o.lines.some((l) => !returnedItemIds(w, o.id).has(l.itemId))) &&
          !w.shipments.some((s) => s.id !== shipment?.id && s.orderIds.includes(o.id)))),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const f = new FormData(event.currentTarget);
      const s = (name: string) => String(f.get(name) || '').trim();
      const date =
        s('date') === initialDate
          ? shipment?.date || new Date().toISOString()
          : new Date(s('date')).toISOString();
      let commands: Command[];
      if (kind === 'Payouts') {
        const allocations = selected.map((orderId) => ({
          orderId,
          amount: parseMoney(amounts[orderId] || '0'),
        }));
        commands = [
          {
            type: 'payout',
            value: payoutSchema.parse({
              id,
              marketplace: market,
              date,
              reference: s('reference'),
              amount: parseMoney(s('amount')),
              allocations,
              notes: s('notes'),
              reversalOf: null,
            }),
          },
        ];
      } else {
        const labelCost = parseMoney(label);
        const allocateCost = f.get('allocate') === 'on';
        const value = shipmentSchema.parse({
          id,
          marketplace: market,
          date,
          orderIds: selected,
          carrier: s('carrier'),
          tracking: s('tracking'),
          status: s('status'),
          labelCost,
          notes: s('notes'),
          allocatedShipping: shipment?.allocatedShipping || allocateCost,
        });
        commands = [];
        if (allocateCost && !shipment?.allocatedShipping) {
          if (labelCost <= 0) throw new Error('Enter a positive label cost to allocate.');
          const shares = allocate(
            labelCost,
            selected.map((id) =>
              w.orders.find((o) => o.id === id)!.lines.reduce((n, l) => n + l.price, 0),
            ),
          );
          selected.forEach((orderId, i) => {
            if (shares[i])
              commands.push({
                type: 'financialEvent',
                value: {
                  id: crypto.randomUUID(),
                  orderId,
                  date,
                  kind: 'Direct cost adjustment',
                  amount: shares[i],
                  reason: `Shipping label · ${s('carrier')} ${s('tracking')}`,
                  itemIds: [],
                  externalId: `shipment:${id}:${orderId}`,
                  reversesId: null,
                  category: 'Shipping',
                },
              });
          });
        }
        commands.push({ type: 'shipment', value });
      }
      if (await dispatch(commands)) {
        notify(
          kind === 'Payouts'
            ? 'Cash receipt recorded without changing profit.'
            : 'Package saved. Related order fulfillment is updated.',
        );
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the form.');
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === 'Payouts' ? 'Record actual payout' : 'Group orders into a package'}
      description={
        kind === 'Payouts'
          ? 'Use the actual receipt date and reference. Every cent must be assigned to an order.'
          : 'Grouping orders does not merge sales or create extra revenue.'
      }
      wide
    >
      <form className="editor-form" onSubmit={submit}>
        {(error || workspaceError) && (
          <div role="alert" className="error-box">
            {error || workspaceError}
          </div>
        )}
        <div className="form-grid">
          <label className="field">
            <span>Marketplace</span>
            <select
              value={market}
              disabled={!!shipment}
              onChange={(e) => {
                setMarket(e.target.value as typeof market);
                setSelected([]);
              }}
            >
              {marketplaces.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <Field
            label={kind === 'Payouts' ? 'Receipt date' : 'Package date'}
            name="date"
            type="datetime-local"
            value={initialDate}
            required
          />
          {kind === 'Payouts' ? (
            <>
              <Field label="Payout reference" name="reference" required />
              <Field
                label="Cash received ($)"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
              />
            </>
          ) : (
            <>
              <Field label="Carrier" name="carrier" value={shipment?.carrier} />
              <Field label="Tracking number" name="tracking" value={shipment?.tracking} />
              <label className="field">
                <span>Shipment status</span>
                <select name="status" defaultValue={shipment?.status || 'Preparing'}>
                  <option>Preparing</option>
                  <option>Shipped</option>
                  <option>Delivered</option>
                </select>
              </label>
              <label className="field">
                <span>Label cost ($)</span>
                <input
                  name="labelCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={label}
                  disabled={shipment?.allocatedShipping}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <div className="line-items">
          <h4>{kind === 'Payouts' ? 'Allocate receipt to orders' : 'Orders in this package'}</h4>
          {orders.map((o) => {
            const remaining = Math.max(
              0,
              currentOrderTotals(w, o).netProceeds - paidForOrder(w, o.id),
            );
            return (
              <div className="line-item" key={o.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!!shipment}
                    checked={selected.includes(o.id)}
                    onChange={(e) => {
                      setSelected(
                        e.target.checked
                          ? [...selected, o.id]
                          : selected.filter((id) => id !== o.id),
                      );
                      setAmounts({ ...amounts, [o.id]: (remaining / 100).toFixed(2) });
                    }}
                  />
                  <span>
                    {o.externalId || o.id.slice(0, 8)} ·{' '}
                    {o.lines.map((l) => w.items.find((i) => i.id === l.itemId)?.title).join(', ')}
                    <small className="block muted">
                      {money(remaining)} net proceeds not allocated to a receipt
                    </small>
                  </span>
                </label>
                {kind === 'Payouts' && selected.includes(o.id) && (
                  <input
                    aria-label={`Payout allocation for ${o.externalId || o.id.slice(0, 8)}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amounts[o.id] || ''}
                    onChange={(e) => setAmounts({ ...amounts, [o.id]: e.target.value })}
                  />
                )}
              </div>
            );
          })}
          {!orders.length && <p className="hint">No eligible orders for this marketplace.</p>}
        </div>
        {kind === 'Shipments' && (
          <label className="check-row">
            <input
              name="allocate"
              type="checkbox"
              disabled={shipment?.allocatedShipping}
              defaultChecked={false}
            />
            <span>
              {shipment?.allocatedShipping
                ? 'This label cost is already allocated. Corrections belong in the dated ledger.'
                : 'Post and split this label cost once. Leave unchecked if shipping is already recorded on the orders.'}
            </span>
          </label>
        )}
        <Field label="Notes" name="notes" value={shipment?.notes} />
        <div className="form-footer">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !selected.length} type="submit">
            {saving ? 'Saving…' : kind === 'Payouts' ? 'Record cash receipt' : 'Save package'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
