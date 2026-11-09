'use client';
import { useState, useCallback, useRef, type FormEvent } from 'react';
import { Camera, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import {
  itemSchema,
  listingSchema,
  orderSchema,
  expenseSchema,
  tripSchema,
  showSchema,
  locationSchema,
  sessionSchema,
  marketplaces,
  categories,
  type Item,
  type Listing,
  type Order,
  type Expense,
  type Trip,
  type Show,
  type Location,
  type Session,
  type Command,
} from '@/lib/model';
import { allocate, parseMoney } from '@/lib/finance';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { ItemPhoto } from './shared';
export type EditorTarget =
  | { kind: 'item'; value?: Item }
  | { kind: 'listing'; value?: Listing; itemId?: string }
  | { kind: 'order'; value?: Order; itemId?: string; showId?: string }
  | { kind: 'expense'; value?: Expense; showId?: string; tripId?: string }
  | { kind: 'trip'; value?: Trip }
  | { kind: 'show'; value?: Show }
  | { kind: 'location'; value?: Location }
  | { kind: 'session'; value?: Session };
export function Field({
  label,
  name,
  value,
  type = 'text',
  required = false,
  children,
  step,
  min,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  children?: React.ReactNode;
  step?: string;
  min?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {children || (
        <input
          name={name}
          type={type}
          defaultValue={value ?? ''}
          required={required}
          step={step}
          min={min}
          maxLength={type === 'text' ? 500 : undefined}
        />
      )}
    </label>
  );
}
const now = () => new Date().toISOString();
const dateValue = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const amt = (value?: number) => ((value || 0) / 100).toFixed(2);
export function Editor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const { w, dispatch, saving, demo, notify, error: workspaceError } = useWorkspace();
  const formRef = useRef<HTMLFormElement>(null);
  const draftKey = `thrift-log.draft.${demo ? 'demo' : 'private'}.${target.kind}.${target.value?.id || 'new'}`;
  const [recovered, setRecovered] = useState(false);
  const attachForm = useCallback(
    (form: HTMLFormElement | null) => {
      formRef.current = form;
      if (!form) return;
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (!raw) return;
        const fields = JSON.parse(raw) as Record<string, string>;
        for (const [name, value] of Object.entries(fields)) {
          const element = form.elements.namedItem(name);
          if (
            (element instanceof HTMLInputElement && !['file', 'checkbox'].includes(element.type)) ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
          ) {
            (element as HTMLInputElement).value = value;
          }
        }
        queueMicrotask(() => setRecovered(true));
      } catch {
        sessionStorage.removeItem(draftKey);
      }
    },
    [draftKey],
  );
  function saveDraft() {
    if (!formRef.current) return;
    const fields = Object.fromEntries(
      [...new FormData(formRef.current)].filter(([, v]) => typeof v === 'string'),
    );
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(fields));
    } catch {}
  }
  const [error, setError] = useState('');
  const [photos, setPhotos] = useState<string[]>(
    target.kind === 'item' ? target.value?.photos || [] : [],
  );
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>(
    target.kind === 'order'
      ? target.value?.lines.map((l) => l.itemId) || (target.itemId ? [target.itemId] : [])
      : [],
  );
  const [linePrices, setLinePrices] = useState<Record<string, string>>({});
  const [lineup, setLineup] = useState<Show['lineup']>(
    target.kind === 'show' ? target.value?.lineup || [] : [],
  );
  const [splitCount, setSplitCount] = useState('1');
  const [id] = useState(() => target.value?.id || crypto.randomUUID());
  const select = (
    name: string,
    value: string,
    options: { value: string; label: string }[],
    placeholder?: string,
  ) => (
    <select name={name} defaultValue={value}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const showSelect = (value?: string | null) => (
    <Field label="Show or event" name="showId">
      {select(
        'showId',
        value || '',
        w.shows.map((s) => ({ value: s.id, label: s.name })),
        'No show / event',
      )}
    </Field>
  );
  const tripSelect = (value?: string | null) => (
    <Field label="Sourcing trip" name="tripId">
      {select(
        'tripId',
        value || '',
        w.trips.map((s) => ({ value: s.id, label: s.name })),
        'No sourcing trip',
      )}
    </Field>
  );
  async function upload(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setError('');
    try {
      const next = [...photos];
      for (const file of Array.from(files)) {
        if (next.length >= 8) throw new Error('Maximum eight photos per item.');
        if (file.size > 5 * 1024 * 1024) throw new Error('Photos must be smaller than 5 MB.');
        if (demo) {
          const data = await new Promise<string>((resolve, reject) => {
            const image = new Image();
            const u = URL.createObjectURL(file);
            image.onload = () => {
              const canvas = document.createElement('canvas');
              const ratio = Math.min(1, 900 / Math.max(image.width, image.height));
              canvas.width = image.width * ratio;
              canvas.height = image.height * ratio;
              canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
              URL.revokeObjectURL(u);
              resolve(canvas.toDataURL('image/jpeg', 0.75));
            };
            image.onerror = () => {
              URL.revokeObjectURL(u);
              reject(new Error('Unable to read photo.'));
            };
            image.src = u;
          });
          next.push(data);
        } else {
          const body = new FormData();
          body.set('file', file);
          const r = await fetch('/api/photos', { method: 'POST', body });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          next.push(data.path);
        }
      }
      setPhotos(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo upload failed.');
    } finally {
      setUploading(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const f = new FormData(event.currentTarget);
      const s = (key: string) => String(f.get(key) || '').trim();
      const m = (key: string) => parseMoney(s(key) || '0');
      const dt = (key: string) => new Date(s(key)).toISOString();
      let command: Command | Command[];
      switch (target.kind) {
        case 'item': {
          const old = target.value;
          const count = old ? 1 : Number(splitCount);
          if (!Number.isInteger(count) || count < 1 || count > 100)
            throw new Error('Use between 1 and 100 items.');
          const costs = allocate(m('cost'), Array(count).fill(1));
          command = costs.map((cost, i) => ({
            type: 'item' as const,
            value: itemSchema.parse({
              id: i === 0 ? id : crypto.randomUUID(),
              sku: count === 1 ? s('sku') : `${s('sku')}-${i + 1}`,
              title: s('title'),
              brand: s('brand'),
              category: s('category') || 'Other',
              size: s('size'),
              color: s('color'),
              condition: s('condition'),
              description: s('description'),
              cost,
              asking: m('asking'),
              purchasedAt: dt('purchasedAt'),
              createdAt: old?.createdAt || now(),
              source: s('source'),
              storage: s('storage'),
              notes: s('notes'),
              tripId: s('tripId') || null,
              status: old?.status === 'Sold' ? 'Sold' : s('status'),
              photos,
            }),
          }));
          break;
        }
        case 'listing':
          command = {
            type: 'listing',
            value: listingSchema.parse({
              id,
              itemId: s('itemId'),
              marketplace: s('marketplace'),
              price: m('price'),
              originalPrice: target.value?.originalPrice ?? m('price'),
              externalId: s('externalId'),
              url: s('url'),
              listedAt: target.value?.listedAt || now(),
              status: s('status'),
              format: s('format'),
              lastSync: target.value?.lastSync || null,
            }),
          };
          break;
        case 'order': {
          const old = target.value;
          const type = s('type');
          const lines =
            type === 'Tip'
              ? []
              : selected.map((itemId) => {
                  const item = w.items.find((i) => i.id === itemId)!;
                  const previous = old?.lines.find((l) => l.itemId === itemId);
                  return {
                    itemId,
                    price:
                      type === 'Giveaway'
                        ? 0
                        : parseMoney(linePrices[itemId] ?? amt(previous?.price ?? item.asking)),
                    costBasis: previous?.costBasis ?? item.cost,
                  };
                });
          command = {
            type: 'order',
            value: orderSchema.parse({
              id,
              marketplace: s('marketplace'),
              externalId: s('externalId'),
              date: dt('date'),
              showId: s('showId') || null,
              lines,
              discount: m('discount'),
              shippingCollected: m('shippingCollected'),
              fees: m('fees'),
              processing: m('processing'),
              shipping: m('shipping'),
              packaging: m('packaging'),
              other: m('other'),
              refund: m('refund'),
              feeCredit: m('feeCredit'),
              adjustment: m('adjustment'),
              tips: m('tips'),
              type,
              status: s('status'),
              fulfillment: s('fulfillment'),
              amountsConfirmed: f.get('amountsConfirmed') === 'on',
              itemFulfillments: old?.itemFulfillments,
              payout: s('payout'),
              provenance: old?.provenance || 'Manual entry',
              importKey: old?.importKey || '',
            }),
          };
          break;
        }
        case 'expense':
          command = {
            type: 'expense',
            value: expenseSchema.parse({
              id,
              title: s('title'),
              category: s('category'),
              amount: m('amount'),
              date: dt('date'),
              showId: s('showId') || null,
              tripId: s('tripId') || null,
            }),
          };
          break;
        case 'location':
          command = {
            type: 'location',
            value: locationSchema.parse({
              id,
              name: s('name'),
              address: s('address'),
              latitude: s('latitude') ? Number(s('latitude')) : null,
              longitude: s('longitude') ? Number(s('longitude')) : null,
            }),
          };
          break;
        case 'trip':
          command = {
            type: 'trip',
            value: tripSchema.parse({
              id,
              name: s('name'),
              locationId: s('locationId') || null,
              date: dt('date'),
              totalSpent: m('totalSpent'),
              notes: s('notes'),
            }),
          };
          break;
        case 'show':
          command = {
            type: 'show',
            value: showSchema.parse({
              id,
              name: s('name'),
              type: s('type'),
              date: dt('date'),
              status: s('status'),
              notes: s('notes'),
              externalId: s('externalId'),
              durationMinutes: Number(s('durationMinutes') || 0),
              lineup,
              checklist: s('checklist')
                .split('\n')
                .map((t) => t.trim())
                .filter(Boolean)
                .map((title) => ({
                  title,
                  done: target.value?.checklist.find((t) => t.title === title)?.done || false,
                })),
            }),
          };
          break;
        case 'session': {
          const start = dt('start'),
            end = dt('end');
          command = {
            type: 'session',
            value: sessionSchema.parse({
              id,
              category: s('category'),
              subcategory: s('subcategory'),
              notes: s('notes'),
              tripId: s('tripId') || null,
              showId: s('showId') || null,
              locationId: null,
              state: 'Ended',
              segments: [{ start, end }],
            }),
          };
          break;
        }
      }
      if (await dispatch(command)) {
        sessionStorage.removeItem(draftKey);
        notify('Saved to your workspace.');
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the form and try again.');
    }
  }
  const titles = {
    item: target.value ? 'Edit item' : 'Add inventory',
    listing: target.value ? 'Edit listing' : 'Add a listing',
    order: target.value ? 'Order details' : 'Record a sale',
    expense: 'Record an expense',
    trip: 'Sourcing trip',
    show: target.value ? 'Edit show or event' : 'Plan a show',
    location: 'Saved location',
    session: 'Log time',
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[target.kind]}
      description={
        target.kind === 'order'
          ? 'Profit is calculated from actual revenue, purchase costs, and direct selling costs.'
          : 'Keep it simple. You can fill in the details later.'
      }
      wide={target.kind === 'order' || target.kind === 'show'}
    >
      <form ref={attachForm} onSubmit={submit} onChange={saveDraft} className="editor-form">
        {recovered && (
          <p className="hint">
            Recovered the text fields from your draft in this tab. Recheck item selections and
            photos before saving.
          </p>
        )}
        {(error || workspaceError) && (
          <div role="alert" className="error-box">
            {error || workspaceError}
          </div>
        )}
        {target.kind === 'item' &&
          (() => {
            const v = target.value;
            return (
              <>
                <div className="photo-upload">
                  <label className="upload-target">
                    <Camera size={24} />
                    <span>{uploading ? 'Uploading…' : 'Add photos'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      capture="environment"
                      onChange={(e) => void upload(e.target.files)}
                      disabled={uploading}
                    />
                  </label>
                  {photos.map((photo, i) => (
                    <button
                      type="button"
                      title="Remove photo"
                      key={i}
                      onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    >
                      <ItemPhoto
                        item={
                          { ...v, photos: [photo], title: 'New item', category: 'Other' } as Item
                        }
                      />
                      <span>Remove</span>
                    </button>
                  ))}
                </div>
                <Field label="Item title" name="title" value={v?.title} required />
                <div className="form-grid">
                  <Field
                    label="SKU"
                    name="sku"
                    value={v?.sku || `TL-${String(w.items.length + 1).padStart(4, '0')}`}
                    required
                  />
                  <Field label="Brand" name="brand" value={v?.brand} />
                  <Field
                    label="Purchase cost ($)"
                    name="cost"
                    value={amt(v?.cost)}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                  <Field
                    label="Asking price ($)"
                    name="asking"
                    value={amt(v?.asking)}
                    type="number"
                    min="0"
                    step="0.01"
                  />
                  <Field label="Category" name="category" value={v?.category || 'Other'} />
                  <Field label="Size" name="size" value={v?.size} />
                  <Field label="Status" name="status">
                    {select(
                      'status',
                      v?.status || 'Purchased',
                      [
                        'Purchased',
                        'Unprocessed',
                        'Ready to List',
                        'Listed',
                        'Reserved',
                        'Returned',
                        'Archived',
                        ...(v?.status === 'Sold' ? ['Sold'] : []),
                      ].map((value) => ({ value, label: value })),
                    )}
                  </Field>
                  <Field
                    label="Purchased"
                    name="purchasedAt"
                    value={dateValue(v?.purchasedAt)}
                    type="datetime-local"
                    required
                  />
                </div>
                {!v && (
                  <Field label="Split this total purchase cost across identical items" name="split">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={splitCount}
                      onChange={(e) => setSplitCount(e.target.value)}
                    />
                  </Field>
                )}
                <details>
                  <summary>More details</summary>
                  <div className="form-grid">
                    <Field label="Source" name="source" value={v?.source} />
                    {tripSelect(v?.tripId)}
                    <Field label="Storage location" name="storage" value={v?.storage} />
                    <Field label="Color" name="color" value={v?.color} />
                    <Field label="Condition" name="condition" value={v?.condition || 'Good'} />
                  </div>
                  <Field label="Description" name="description" value={v?.description} />
                  <Field label="Notes" name="notes" value={v?.notes} />
                </details>
              </>
            );
          })()}
        {target.kind === 'listing' &&
          (() => {
            const v = target.value;
            return (
              <>
                <Field label="Inventory item" name="itemId">
                  {select(
                    'itemId',
                    v?.itemId || target.itemId || '',
                    w.items
                      .filter((i) => i.status !== 'Sold' || i.id === v?.itemId)
                      .map((i) => ({ value: i.id, label: `${i.sku} · ${i.title}` })),
                  )}
                </Field>
                <div className="form-grid">
                  <Field label="Marketplace" name="marketplace">
                    {select(
                      'marketplace',
                      v?.marketplace || 'Depop',
                      marketplaces.map((value) => ({ value, label: value })),
                    )}
                  </Field>
                  <Field
                    label="Asking price ($)"
                    name="price"
                    value={amt(v?.price)}
                    type="number"
                    step="0.01"
                    min="0"
                    required
                  />
                  <Field label="Status" name="status">
                    {select(
                      'status',
                      v?.status || 'Active',
                      ['Active', 'Sold', 'Needs delisting', 'Ended'].map((value) => ({
                        value,
                        label: value,
                      })),
                    )}
                  </Field>
                  <Field label="Sale format" name="format">
                    {select(
                      'format',
                      v?.format || 'Fixed price',
                      ['Fixed price', 'Auction'].map((value) => ({ value, label: value })),
                    )}
                  </Field>
                </div>
                <Field label="External listing ID" name="externalId" value={v?.externalId} />
                <Field label="Listing URL (HTTPS)" name="url" value={v?.url} type="url" />
                <p className="hint">
                  These are internal records. Updating them does not change the external marketplace
                  listing.
                </p>
              </>
            );
          })()}
        {target.kind === 'order' &&
          (() => {
            const v = target.value;
            const available = w.items.filter(
              (i) => selected.includes(i.id) || !['Sold', 'Archived'].includes(i.status),
            );
            return (
              <>
                <div className="form-grid">
                  <Field label="Marketplace" name="marketplace">
                    {select(
                      'marketplace',
                      v?.marketplace || (target.showId ? 'Whatnot' : 'Depop'),
                      marketplaces.map((value) => ({ value, label: value })),
                    )}
                  </Field>
                  <Field
                    label="Date"
                    name="date"
                    value={dateValue(v?.date)}
                    type="datetime-local"
                    required
                  />
                  <Field label="Transaction type" name="type">
                    {select(
                      'type',
                      v?.type || 'Sale',
                      ['Sale', 'Giveaway', 'Tip'].map((value) => ({ value, label: value })),
                    )}
                  </Field>
                  {showSelect(v?.showId || target.showId)}
                </div>
                <div className="line-items">
                  <h4>Physical items & final sale prices</h4>
                  {available.map((item) => (
                    <div className="line-item" key={item.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          disabled={!!v}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, item.id]
                                : selected.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span>
                          {item.sku} · {item.title}
                        </span>
                      </label>
                      {selected.includes(item.id) && (
                        <input
                          aria-label={`Sale price for ${item.sku}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={
                            linePrices[item.id] ??
                            amt(v?.lines.find((l) => l.itemId === item.id)?.price ?? item.asking)
                          }
                          onChange={(e) =>
                            setLinePrices({ ...linePrices, [item.id]: e.target.value })
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="form-grid">
                  <Field
                    label="Marketplace fees ($)"
                    name="fees"
                    value={amt(v?.fees)}
                    type="number"
                    step="0.01"
                    min="0"
                  />
                  <Field
                    label="Processing fees ($)"
                    name="processing"
                    value={amt(v?.processing)}
                    type="number"
                    step="0.01"
                    min="0"
                  />
                  <Field
                    label="Seller-paid shipping ($)"
                    name="shipping"
                    value={amt(v?.shipping)}
                    type="number"
                    step="0.01"
                    min="0"
                  />
                  <Field
                    label="Packaging ($)"
                    name="packaging"
                    value={amt(v?.packaging)}
                    type="number"
                    step="0.01"
                    min="0"
                  />
                </div>
                <details open={!!v}>
                  <summary>Order, refunds & adjustments</summary>
                  <div className="form-grid">
                    <Field label="External order ID" name="externalId" value={v?.externalId} />
                    <Field label="Status" name="status">
                      {select(
                        'status',
                        v?.status || 'Completed',
                        ['Completed', 'Cancelled', 'Returned'].map((value) => ({
                          value,
                          label: value,
                        })),
                      )}
                    </Field>
                    <Field label="Fulfillment" name="fulfillment">
                      {select(
                        'fulfillment',
                        v?.fulfillment || 'Unfulfilled',
                        ['Unfulfilled', 'Shipped', 'Delivered'].map((value) => ({
                          value,
                          label: value,
                        })),
                      )}
                    </Field>
                    <Field label="Payout" name="payout">
                      {select(
                        'payout',
                        v?.payout || 'Pending',
                        ['Pending', 'Paid'].map((value) => ({ value, label: value })),
                      )}
                    </Field>
                    {(
                      [
                        'discount',
                        'shippingCollected',
                        'other',
                        'refund',
                        'feeCredit',
                        'adjustment',
                        'tips',
                      ] as const
                    ).map((key) => (
                      <Field
                        key={key}
                        label={`${({ discount: 'Discount', shippingCollected: 'Buyer shipping', other: 'Other direct costs', refund: 'Refund paid', feeCredit: 'Fee credit', adjustment: 'Revenue adjustment (signed)', tips: 'Tips' } as const)[key]} ($)`}
                        name={key}
                        value={amt(v?.[key])}
                        type="number"
                        step="0.01"
                        min={key === 'adjustment' ? undefined : '0'}
                      />
                    ))}
                  </div>
                  <p className="hint">
                    Returned orders restore all their inventory and reverse COGS. Record the actual
                    refund separately. Partial refunds keep status Completed. Cancellation does not
                    automatically reverse recorded fees.
                  </p>
                </details>
              </>
            );
          })()}
        {target.kind === 'expense' && (
          <>
            <Field label="Expense" name="title" value={target.value?.title} required />
            <div className="form-grid">
              <Field
                label="Amount ($)"
                name="amount"
                value={amt(target.value?.amount)}
                type="number"
                min="0"
                step="0.01"
                required
              />
              <Field
                label="Category"
                name="category"
                value={target.value?.category || 'Supplies'}
              />
              <Field
                label="Date"
                name="date"
                value={dateValue(target.value?.date)}
                type="datetime-local"
                required
              />
              {showSelect(target.value?.showId || target.showId)}
              {tripSelect(target.value?.tripId || target.tripId)}
            </div>
            <p className="hint">
              Use this for operating costs. Inventory purchases become COGS when sold. Costs already
              on an order should not be entered again here.
            </p>
          </>
        )}
        {target.kind === 'location' && (
          <>
            <Field label="Location name" name="name" value={target.value?.name} required />
            <Field label="Address" name="address" value={target.value?.address} />
            <details>
              <summary>Location suggestions (optional)</summary>
              <div className="form-grid">
                <Field
                  label="Latitude"
                  name="latitude"
                  value={target.value?.latitude ?? ''}
                  type="number"
                  step="any"
                />
                <Field
                  label="Longitude"
                  name="longitude"
                  value={target.value?.longitude ?? ''}
                  type="number"
                  step="any"
                />
              </div>
              <p className="hint">
                Suggestions use foreground location only, with your permission. No background
                geofencing.
              </p>
            </details>
          </>
        )}
        {target.kind === 'trip' && (
          <>
            <Field label="Trip name" name="name" value={target.value?.name} required />
            <div className="form-grid">
              <Field label="Saved location" name="locationId">
                {select(
                  'locationId',
                  target.value?.locationId || '',
                  w.locations.map((l) => ({ value: l.id, label: l.name })),
                  'No saved location',
                )}
              </Field>
              <Field
                label="Date"
                name="date"
                value={dateValue(target.value?.date)}
                type="datetime-local"
                required
              />
              <Field
                label="Total purchase spend ($)"
                name="totalSpent"
                value={amt(target.value?.totalSpent)}
                type="number"
                min="0"
                step="0.01"
              />
            </div>
            <Field label="Notes" name="notes" value={target.value?.notes} />
            <p className="hint">
              Trip spending tracks cash spent. Item cost basis must be assigned separately; it is
              not deducted again as an expense.
            </p>
          </>
        )}
        {target.kind === 'show' &&
          (() => {
            const v = target.value;
            return (
              <>
                <Field label="Show or event name" name="name" value={v?.name} required />
                <div className="form-grid">
                  <Field label="Type" name="type">
                    {select(
                      'type',
                      v?.type || 'Whatnot',
                      ['Whatnot', 'In person'].map((value) => ({ value, label: value })),
                    )}
                  </Field>
                  <Field
                    label="Scheduled time"
                    name="date"
                    value={dateValue(v?.date)}
                    type="datetime-local"
                    required
                  />
                  <Field label="Status" name="status">
                    {select(
                      'status',
                      v?.status || 'Planned',
                      ['Planned', 'Live', 'Ended'].map((value) => ({ value, label: value })),
                    )}
                  </Field>
                  <Field
                    label="Livestream / event duration (minutes)"
                    name="durationMinutes"
                    value={v?.durationMinutes || 0}
                    type="number"
                    min="0"
                  />
                </div>
                <div className="line-items">
                  <h4>Build your lineup</h4>
                  {w.items
                    .filter(
                      (i) =>
                        !['Sold', 'Archived'].includes(i.status) ||
                        lineup.some((l) => l.itemId === i.id),
                    )
                    .map((item) => {
                      const line = lineup.find((l) => l.itemId === item.id);
                      return (
                        <div className="line-item" key={item.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={!!line}
                              onChange={(e) =>
                                setLineup(
                                  e.target.checked
                                    ? [
                                        ...lineup,
                                        {
                                          itemId: item.id,
                                          startingBid: item.asking,
                                          presented: false,
                                        },
                                      ]
                                    : lineup.filter((l) => l.itemId !== item.id),
                                )
                              }
                            />
                            <span>
                              {item.sku} · {item.title}
                            </span>
                          </label>
                          {line && (
                            <>
                              <input
                                aria-label={`Starting bid for ${item.sku}`}
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.startingBid / 100}
                                onChange={(e) => {
                                  try {
                                    const bid = parseMoney(e.target.value);
                                    setLineup(
                                      lineup.map((l) =>
                                        l.itemId === item.id ? { ...l, startingBid: bid } : l,
                                      ),
                                    );
                                  } catch {}
                                }}
                              />
                              <label className="hint">
                                <input
                                  type="checkbox"
                                  checked={line.presented}
                                  onChange={(e) =>
                                    setLineup(
                                      lineup.map((l) =>
                                        l.itemId === item.id
                                          ? { ...l, presented: e.target.checked }
                                          : l,
                                      ),
                                    )
                                  }
                                />
                                Presented
                              </label>
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
                <Field label="Preparation checklist (one task per line)" name="checklist">
                  <textarea
                    name="checklist"
                    rows={3}
                    defaultValue={
                      v?.checklist.map((c) => c.title).join('\n') ||
                      'Prepare lineup\nSet up shipping station\nShare the show'
                    }
                  />
                </Field>
                <Field label="Whatnot show ID (optional)" name="externalId" value={v?.externalId} />
                <Field label="Notes / location" name="notes" value={v?.notes} />
                <p className="hint">
                  Ending a show releases unsold inventory. Duration is used only for profit per
                  livestream hour; log labor with the timer to avoid double counting.
                </p>
              </>
            );
          })()}
        {target.kind === 'session' && (
          <>
            <div className="form-grid">
              <Field label="Activity" name="category">
                {select(
                  'category',
                  target.value?.category || 'Buying',
                  categories.map((value) => ({ value, label: value })),
                )}
              </Field>
              <Field label="Subcategory" name="subcategory" value={target.value?.subcategory} />
              <Field
                label="Started"
                name="start"
                value={dateValue(target.value?.segments[0]?.start)}
                type="datetime-local"
                required
              />
              <Field
                label="Ended"
                name="end"
                value={dateValue(target.value?.segments.at(-1)?.end || undefined)}
                type="datetime-local"
                required
              />
              {showSelect(target.value?.showId)}
              {tripSelect(target.value?.tripId)}
            </div>
            <Field label="Notes" name="notes" value={target.value?.notes} />
            <p className="hint">
              Editing replaces this session’s intervals. Overlapping time is counted once in total
              hours.
            </p>
          </>
        )}
        {target.kind === 'order' && (
          <label className="check-row">
            <input
              type="checkbox"
              name="amountsConfirmed"
              defaultChecked={target.value?.amountsConfirmed ?? false}
            />
            I confirm the purchase cost and all selling amounts, including any $0 fees or shipping,
            are known.
          </label>
        )}
        <div className="form-footer">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || uploading}>
            <Plus size={16} />
            {saving
              ? 'Saving…'
              : target.value
                ? 'Save changes'
                : target.kind === 'order'
                  ? 'Record transaction'
                  : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
