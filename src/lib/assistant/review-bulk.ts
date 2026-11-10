import type { DraftBatch, DraftRow } from './drafts';
import type { Workspace } from '../model';
import { allocate } from '../money';
import { plausibleInventoryMatches } from './matching';
import { listingAmount } from './listing-review';

/** Contradictory proposals for the same unique identifier must not dilute a batch cost. */
export function pendingIdentityConflicts(batch: DraftBatch) {
  const identifiers = new Map<string, Set<string>>();
  for (const row of batch.rows) {
    if (!row.included || row.facts.kind !== 'listing') continue;
    row.matches.forEach((m, index) => {
      if (!m.newItem || m.itemId) return;
      const line = row.facts.lines[index];
      if (!line) return;
      const keys = [
        line.sku?.trim().toLowerCase() ? `sku:${line.sku.trim().toLowerCase()}` : '',
        ...[line.listingId, line.externalProductId]
          .filter(Boolean)
          .map((id) => `${row.facts.marketplace}:id:${id}`),
      ];
      if (line.url)
        try {
          const url = new URL(line.url);
          keys.push(
            `${row.facts.marketplace}:url:${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}`,
          );
        } catch {
          /* The planner reports invalid listing URLs. */
        }
      for (const key of keys.filter(Boolean)) {
        const ids = identifiers.get(key) || new Set<string>();
        ids.add(m.newItem.id);
        identifiers.set(key, ids);
      }
    });
  }
  return new Set(
    [...identifiers.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids]),
  );
}

export function eligiblePhysicalDrafts(w: Workspace, batch: DraftBatch) {
  const conflicts = pendingIdentityConflicts(batch);
  const groups = new Map<string, { id: string; title: string; eligible: boolean }>();
  for (const row of batch.rows) {
    if (!row.included || row.facts.kind !== 'listing' || row.facts.status !== 'active') continue;
    row.matches.forEach((match, index) => {
      if (!match.newItem || match.itemId) return;
      const id = match.newItem.id;
      const safe =
        !conflicts.has(id) &&
        !w.items.some((item) => item.id === id) &&
        !plausibleInventoryMatches(w, row.facts, row.facts.lines[index]).some(
          (candidate) =>
            candidate.exact || !match.dismissedCandidateIds?.includes(candidate.item.id),
        );
      const group = groups.get(id);
      groups.set(id, {
        id,
        title: row.facts.lines[index].title || 'Untitled item',
        eligible: safe && (group?.eligible ?? true),
      });
    });
  }
  return [...groups.values()].filter((group) => group.eligible);
}

/** Allocate once per physical draft; every linked marketplace view receives the same cost. */
export function applyBatchCost(
  w: Workspace,
  input: DraftBatch,
  mode: 'same' | 'split',
  raw: string,
  selectedIds?: string[],
) {
  const { value, error } = listingAmount(raw);
  if (error || value === null)
    throw new Error(error || 'Enter a purchase cost, including 0 for free inventory.');
  const groups = eligiblePhysicalDrafts(w, input).filter(
    (group) => !selectedIds || selectedIds.includes(group.id),
  );
  if (!groups.length)
    throw new Error(
      'No eligible new physical items selected. Resolve match or duplicate conflicts first.',
    );
  const values =
    mode === 'split'
      ? allocate(
          value,
          groups.map(() => 1),
        )
      : groups.map(() => value);
  const costs = new Map(groups.map((group, i) => [group.id, values[i]]));
  const batch = structuredClone(input);
  for (const row of batch.rows)
    for (const match of row.matches)
      if (match.newItem && costs.has(match.newItem.id)) {
        const cost = costs.get(match.newItem.id)!;
        match.newItem.cost = cost;
        match.purchaseCost = cost;
        match.costInput = (cost / 100).toFixed(2);
        match.costAllocation = { mode, total: value, count: groups.length };
      }
  return batch;
}

export function setBatchAcquisitionDate(input: DraftBatch, value: string) {
  const batch = structuredClone(input);
  for (const row of batch.rows)
    if (row.facts.kind === 'listing')
      for (const match of row.matches)
        if (match.newItem) {
          match.newItem.purchasedAt = value;
          match.newItem.assumedAcquisitionDate = false;
        }
  return batch;
}

/** Editing one view of a pending physical item updates its other cross-listings too. */
export function updateReviewRow(input: DraftBatch, updated: DraftRow) {
  const before = input.rows.find((r) => r.id === updated.id);
  return {
    ...input,
    rows: input.rows.map((row) => {
      if (row.id === updated.id) return updated;
      return {
        ...row,
        matches: row.matches.map((m) => {
          if (!m.newItem) return m;
          const index = before?.matches.findIndex((old) => old.newItem?.id === m.newItem!.id) ?? -1;
          if (index < 0) return m;
          const source = updated.matches[index];
          return {
            ...m,
            itemId: source.itemId,
            newItem: source.newItem ? { ...source.newItem } : null,
            costInput: source.costInput,
            purchaseCost: source.purchaseCost,
            costOverride: source.costOverride,
            costCorrection: source.costCorrection,
            confirmZeroCost: source.confirmZeroCost,
            costAllocation: source.costAllocation,
            dismissedCandidateIds: source.dismissedCandidateIds,
          };
        }),
      };
    }),
  };
}

/** After partial approval a pending cross-listing must reuse the newly persisted inventory. */
export function reconcileApprovedDrafts(input: DraftBatch, w: Workspace) {
  const createdIds = new Set<string>();
  for (const receipt of w.imports) {
    if (receipt.mapping.batchId !== input.id || receipt.mapping.format !== 'assistant-v1') continue;
    try {
      const audit = JSON.parse(receipt.rawCsv);
      if (audit.authorization?.kind === 'final-approval')
        for (const id of audit.authorization.newItemIds || []) createdIds.add(id);
    } catch {
      /* A malformed receipt cannot authorize an identity change. */
    }
  }
  return {
    ...input,
    rows: input.rows.map((row) => ({
      ...row,
      matches: row.matches.map((m) =>
        m.newItem &&
        createdIds.has(m.newItem.id) &&
        w.items.some((item) => item.id === m.newItem!.id)
          ? {
              ...m,
              itemId: m.newItem.id,
              newItem: null,
              costInput: undefined,
              purchaseCost: undefined,
            }
          : m,
      ),
    })),
  };
}
