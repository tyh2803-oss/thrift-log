'use client';
import { useState } from 'react';
import { newInventoryDraft, type DraftRow } from '@/lib/assistant/drafts';
import { matchInventory } from '@/lib/assistant/matching';
import type { Workspace } from '@/lib/model';
import { money } from '@/lib/money';
import { Button } from './ui/button';

/** Identity decisions stay visible: fuzzy suggestions never select a physical item automatically. */
export function ListingInventory({
  row,
  index,
  w,
  contextItemId,
  onChange,
}: {
  row: DraftRow;
  index: number;
  w: Workspace;
  contextItemId?: string;
  onChange: (row: DraftRow) => void;
}) {
  const [search, setSearch] = useState('');
  const match = row.matches[index];
  const candidates = matchInventory(w, row.facts, row.facts.lines[index]);
  const selected = w.items.find((item) => item.id === match.itemId);
  const inventory = w.items
    .filter((item) =>
      contextItemId
        ? item.id === contextItemId
        : `${item.title} ${item.sku} ${item.brand} ${item.size}`
            .toLowerCase()
            .includes(search.toLowerCase()),
    )
    .slice(0, 30);
  for (const item of [selected, ...candidates.map((c) => c.item)])
    if (
      item &&
      !inventory.some((v) => v.id === item.id) &&
      (!contextItemId || item.id === contextItemId)
    )
      inventory.unshift(item);
  function choose(itemId: string | null) {
    onChange({
      ...row,
      matches: row.matches.map((m, i) =>
        i === index
          ? {
              ...m,
              itemId,
              newItem:
                itemId || contextItemId
                  ? null
                  : newInventoryDraft(row.facts.lines[index].sku, m.purchaseCost ?? null),
              costOverride: undefined,
              costCorrection: false,
              costInput: undefined,
              confirmZeroCost: false,
            }
          : m,
      ),
    });
  }
  return (
    <div className="assistant-listing-identity">
      <strong>
        {selected
          ? `Matched inventory: ${selected.title}`
          : contextItemId
            ? 'Inventory match needed'
            : 'Suggested new physical item · Not saved'}
      </strong>
      {!!w.items.length && (
        <>
          <label className="field">
            <span>Search inventory, line {index + 1}</span>
            <input
              value={search}
              placeholder="Title, brand, SKU or size"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Inventory match, line {index + 1}</span>
            <select
              value={match.itemId || ''}
              data-review-missing={!match.itemId && !match.newItem}
              onChange={(e) => choose(e.target.value || null)}
            >
              <option value="">
                {contextItemId ? 'Choose selected inventory item' : 'New physical item draft'}
              </option>
              {inventory.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.title} · {money(item.cost)}
                </option>
              ))}
            </select>
          </label>
          {!contextItemId &&
            !selected &&
            candidates.slice(0, 3).map((candidate) => (
              <Button
                key={candidate.item.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => choose(candidate.item.id)}
              >
                Use possible match: {candidate.item.title} · {candidate.item.sku} (
                {candidate.reason})
              </Button>
            ))}
        </>
      )}
      {!contextItemId && !selected && !match.newItem && (
        <Button
          type="button"
          variant="outline"
          data-review-missing="true"
          onClick={() => choose(null)}
        >
          Create new physical item draft
        </Button>
      )}
      {match.newItem && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={match.newItem.confirmedDistinct}
            data-review-missing={!match.newItem.confirmedDistinct}
            onChange={(e) =>
              onChange({
                ...row,
                matches: row.matches.map((m, i) =>
                  i === index
                    ? {
                        ...m,
                        newItem: { ...m.newItem!, confirmedDistinct: e.target.checked },
                      }
                    : m,
                ),
              })
            }
          />
          I checked inventory and confirm this is a new physical item.
        </label>
      )}
      {match.newItem && (
        <small>Review possible matches before confirming. Nothing is created until approval.</small>
      )}
    </div>
  );
}
