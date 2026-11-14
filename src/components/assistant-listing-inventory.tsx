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
  pendingItems = [],
}: {
  row: DraftRow;
  index: number;
  w: Workspace;
  contextItemId?: string;
  pendingItems?: { id: string; title: string; match: DraftRow['matches'][number] }[];
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
                  : newInventoryDraft(
                      row.facts.lines[index].sku,
                      m.purchaseCost ?? null,
                      w.settings.timezone,
                    ),
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
              aria-label={`Inventory match, line ${index + 1}`}
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
      {!contextItemId && match.newItem && pendingItems.some((p) => p.id !== match.newItem!.id) && (
        <label className="field">
          <span>Same physical item as another proposal</span>
          <select
            value=""
            onChange={(e) => {
              const target = pendingItems.find((p) => p.id === e.target.value);
              if (!target) return;
              onChange({
                ...row,
                matches: row.matches.map((m, i) =>
                  i === index
                    ? {
                        ...m,
                        newItem: structuredClone(target.match.newItem),
                        costInput: target.match.costInput,
                        purchaseCost: target.match.purchaseCost,
                        costAllocation: target.match.costAllocation,
                        dismissedCandidateIds: target.match.dismissedCandidateIds,
                      }
                    : m,
                ),
              });
            }}
          >
            <option value="">Keep separate physical item</option>
            {pendingItems
              .filter((p) => p.id !== match.newItem!.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </label>
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
    </div>
  );
}
