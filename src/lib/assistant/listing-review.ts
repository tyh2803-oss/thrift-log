import { parseMoney } from '../money';
import type { Workspace } from '../model';
import type { DraftRow } from './drafts';
/** Preserve incomplete typing in the draft while keeping all financial values in cents. */
export function listingAmount(raw: string): { value: number | null; error: string | null } {
  if (!raw.trim()) return { value: null, error: null };
  try {
    const value = parseMoney(raw.trim().replace(/^(\.)/, '0.'));
    if (value < 0) throw new Error('negative');
    return { value, error: null };
  } catch {
    return {
      value: null,
      error: 'Enter a non-negative amount with up to two decimals (maximum $1,000,000).',
    };
  }
}
export function listingCost(w: Workspace, row: DraftRow, index: number) {
  const m = row.matches[index];
  const item = w.items.find((i) => i.id === m?.itemId);
  if (m?.costInput !== undefined && (listingAmount(m.costInput).error || !m.costInput.trim()))
    return null;
  if (item) {
    const value = m.costOverride ?? item.cost;
    return value === 0 && !m.confirmZeroCost && m.costOverride == null ? null : value;
  }
  return m?.newItem?.cost ?? m?.purchaseCost ?? null;
}
export function listingPotential(
  w: Workspace,
  row: DraftRow,
  index: number,
  cost = listingCost(w, row, index),
) {
  const price = row.facts.lines[index]?.price ?? null;
  const gross = cost !== null && price !== null ? price - cost : null;
  return {
    cost,
    gross,
    net:
      gross !== null && w.settings.estimatedSellingExpenses !== null
        ? gross - w.settings.estimatedSellingExpenses
        : null,
  };
}
export function changeListingCost(
  w: Workspace,
  input: DraftRow,
  index: number,
  raw: string,
): DraftRow {
  const row = structuredClone(input),
    match = row.matches[index];
  const item = w.items.find((i) => i.id === match.itemId);
  if (item && item.cost > 0 && !match.costCorrection && match.costOverride == null)
    throw new Error('Choose Correct cost before proposing an acquisition-cost change.');
  const { value } = listingAmount(raw);
  match.costInput = raw;
  if (item) {
    if (value !== null && value !== item.cost) match.costCorrection = true;
    match.costOverride = value === item.cost ? undefined : value;
    match.confirmZeroCost = value === 0;
  } else {
    match.purchaseCost = value;
    if (match.newItem) match.newItem.cost = value;
  }
  return row;
}
export function changeListingPrice(input: DraftRow, index: number, raw: string): DraftRow {
  const row = structuredClone(input);
  row.matches[index].priceInput = raw;
  row.facts.lines[index].price = listingAmount(raw).value;
  return row;
}
