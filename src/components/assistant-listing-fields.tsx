'use client';
import { useId } from 'react';
import type { DraftRow } from '@/lib/assistant/drafts';
import {
  changeListingCost,
  changeListingPrice,
  listingAmount,
  listingPotential,
} from '@/lib/assistant/listing-review';
import { correctedMarketplace, emptyClothing } from '@/lib/assistant/vision';
import { vintageClassifications } from '@/lib/assistant/clothing';
import type { Workspace } from '@/lib/model';
import { money } from '@/lib/money';
import { ClothingEditor } from './assistant-clothing';
import { Button } from './ui/button';

function CurrencyInput({
  label,
  raw,
  onChange,
  readOnly = false,
}: {
  label: string;
  raw: string;
  onChange: (raw: string) => void;
  readOnly?: boolean;
}) {
  const id = useId(),
    error = listingAmount(raw).error;
  return (
    <label className="field">
      <span>{label} ($)</span>
      <input
        aria-label={`${label} ($)`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? id : undefined}
        readOnly={readOnly}
        value={raw}
        placeholder="Unknown"
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <small className="error-text" id={id}>
          {error}
        </small>
      )}
    </label>
  );
}
export function ListingFields({
  row,
  index,
  w,
  busy,
  previewCost,
  onChange,
}: {
  row: DraftRow;
  index: number;
  w: Workspace;
  busy: boolean;
  previewCost: number | null;
  onChange: (row: DraftRow) => void;
}) {
  const line = row.facts.lines[index],
    match = row.matches[index];
  const item = w.items.find((i) => i.id === match.itemId);
  const potential = listingPotential(w, row, index, previewCost);
  const correcting = match.costCorrection || match.costOverride != null;
  const cost = match.costInput ?? (potential.cost === null ? '' : String(potential.cost / 100));
  const price = match.priceInput ?? (line.price === null ? '' : String(line.price / 100));
  function updateLine(value: Partial<typeof line>) {
    onChange({
      ...row,
      facts: {
        ...row.facts,
        lines: row.facts.lines.map((l, i) => (i === index ? { ...l, ...value } : l)),
      },
    });
  }
  const clothing = line.clothing || emptyClothing();
  return (
    <fieldset
      disabled={busy}
      className="assistant-listing-inline"
      aria-label={`Listing fields, item ${index + 1}`}
    >
      <div className="assistant-listing-money">
        <CurrencyInput
          label="Purchase Cost"
          raw={cost}
          readOnly={!!item && item.cost > 0 && !correcting}
          onChange={(raw) => onChange(changeListingCost(w, row, index, raw))}
        />
        <CurrencyInput
          label="Listing Price"
          raw={price}
          onChange={(raw) => onChange(changeListingPrice(row, index, raw))}
        />
        <label className="field assistant-listing-marketplace">
          <span>Marketplace</span>
          <select
            aria-label="Marketplace"
            value={row.facts.marketplace || ''}
            onChange={(e) => {
              const marketplace = (e.target.value || null) as DraftRow['facts']['marketplace'];
              onChange({
                ...row,
                facts: {
                  ...row.facts,
                  marketplace,
                  marketplaceIdentification: correctedMarketplace(
                    row.facts.marketplaceIdentification,
                    marketplace,
                  ),
                },
              });
            }}
          >
            <option value="">Choose marketplace</option>
            {['Vinted', 'Depop', 'eBay', 'Whatnot'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      {item && (
        <div className="assistant-cost-note">
          <small>
            Stored acquisition cost:{' '}
            {item.cost === 0 && !match.confirmZeroCost ? 'unconfirmed $0' : money(item.cost)}.
          </small>
          {previewCost !== null && previewCost !== item.cost && match.costOverride == null && (
            <small>
              Batch preview uses the acquisition-cost correction proposed on another listing.
            </small>
          )}
          {!correcting ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...row,
                  matches: row.matches.map((m, i) =>
                    i === index ? { ...m, costCorrection: true } : m,
                  ),
                })
              }
            >
              Correct cost
            </Button>
          ) : (
            <>
              <small>
                Proposed correction — changes inventory acquisition cost only after approval.
                Previous sale cost snapshots stay unchanged.
              </small>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({
                    ...row,
                    matches: row.matches.map((m, i) =>
                      i === index
                        ? {
                            ...m,
                            costCorrection: false,
                            costOverride: undefined,
                            costInput: undefined,
                          }
                        : m,
                    ),
                  })
                }
              >
                Cancel cost correction
              </Button>
            </>
          )}
        </div>
      )}
      <div className="assistant-listing-potential" aria-live="polite">
        <strong>
          Potential gross profit:{' '}
          {potential.cost === null
            ? 'Cost needed'
            : potential.gross === null
              ? 'Listing price needed'
              : money(potential.gross)}
        </strong>
        {potential.net !== null && (
          <small>
            Estimated net profit: {money(potential.net)} · configured selling expenses{' '}
            {money(w.settings.estimatedSellingExpenses!)} per item.
          </small>
        )}
        <small>Gross excludes selling expenses. These are estimates, not earned profit.</small>
      </div>
      <details className="assistant-listing-details">
        <summary>Edit additional details</summary>
        <div className="form-grid">
          {(
            [
              'title',
              'brand',
              'category',
              'size',
              'color',
              'condition',
              'listingId',
              'url',
              'description',
            ] as const
          ).map((key) => (
            <label className="field" key={key}>
              <span>
                {
                  {
                    title: 'Item title',
                    brand: 'Brand',
                    category: 'Category',
                    size: 'Size',
                    color: 'Color',
                    condition: 'Condition',
                    listingId: 'Listing ID',
                    url: 'Listing URL',
                    description: 'Description',
                  }[key]
                }
              </span>
              <input
                value={line[key] || ''}
                maxLength={key === 'url' ? 2000 : 500}
                onChange={(e) => updateLine({ [key]: e.target.value || null })}
              />
            </label>
          ))}
          <label className="field">
            <span>Garment type</span>
            <input
              maxLength={500}
              value={clothing.garmentType || ''}
              onChange={(e) =>
                updateLine({ clothing: { ...clothing, garmentType: e.target.value || null } })
              }
            />
          </label>
          <label className="field">
            <span>Vintage classification</span>
            <select
              aria-label="Vintage classification"
              value={clothing.vintage.classification}
              onChange={(e) =>
                updateLine({
                  clothing: {
                    ...clothing,
                    vintage: {
                      ...clothing.vintage,
                      classification: e.target.value as typeof clothing.vintage.classification,
                      confirmedByUser: false,
                    },
                  },
                })
              }
            >
              {vintageClassifications.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Listing date (workspace timezone)</span>
            <input
              placeholder="YYYY-MM-DD or timestamp"
              value={row.facts.date || ''}
              onChange={(e) =>
                onChange({ ...row, facts: { ...row.facts, date: e.target.value || null } })
              }
            />
          </label>
          <label className="field">
            <span>Import notes</span>
            <textarea
              maxLength={500}
              value={match.notes || ''}
              onChange={(e) =>
                onChange({
                  ...row,
                  matches: row.matches.map((m, i) =>
                    i === index ? { ...m, notes: e.target.value } : m,
                  ),
                })
              }
            />
          </label>
        </div>
        <ClothingEditor line={line} onChange={(value) => updateLine(value)} />
        {item && (
          <small>
            Descriptive corrections and notes stay with this import; existing item attributes,
            photos and sourcing history are preserved.
          </small>
        )}
      </details>
    </fieldset>
  );
}
