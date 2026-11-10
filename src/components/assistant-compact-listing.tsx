'use client';
import { ChevronDown, Shirt, Trash2 } from 'lucide-react';
import { useId } from 'react';
import type { Preview } from '@/lib/assistant/planner';
import type { DraftRow } from '@/lib/assistant/drafts';
import type { Screenshot } from '@/lib/assistant/schema';
import type { Workspace } from '@/lib/model';
import { changeListingCost, listingAmount, listingPotential } from '@/lib/assistant/listing-review';
import { plausibleInventoryMatches } from '@/lib/assistant/matching';
import { money } from '@/lib/money';
import { ClothingPreview } from './assistant-clothing';
import { ListingFields } from './assistant-listing-fields';
import { LifecycleFields } from './assistant-lifecycle-fields';
import { Button } from './ui/button';

/** One short next action, with the full diagnostic context available only on demand. */
export function listingNextAction(issues: string[]) {
  const issue = issues[0] || '';
  if (/Possible existing item/.test(issue))
    return 'Possible existing item — choose a match or create a different item.';
  if (/purchase cost is unknown/.test(issue)) return 'Enter purchase cost, or 0 if free.';
  if (/acquisition cannot/.test(issue))
    return 'Set acquisition date on or before the original listing date.';
  if (/acquisition date/.test(issue)) return 'Choose a valid acquisition date.';
  if (/already|duplicate|more than once|Another included/.test(issue))
    return 'Possible duplicate — choose existing inventory or discard this proposal.';
  return issue.replace(/^Line \d+: /, '');
}

export function CompactListing({
  preview: p,
  w,
  index,
  source,
  imageUrl,
  contextItemId,
  busy,
  onChange,
  onRemove,
  onView,
  pendingItems,
}: {
  pendingItems: { id: string; title: string; match: DraftRow['matches'][number] }[];
  preview: Preview;
  w: Workspace;
  index: number;
  source?: Screenshot;
  imageUrl?: string;
  contextItemId?: string;
  busy: boolean;
  onChange: (row: DraftRow) => void;
  onRemove: () => void;
  onView: (kind: 'listing' | 'order', id: string) => void;
}) {
  const row = p.row,
    messageId = useId();
  function expand() {
    const details = document.getElementById(
      `listing-details-${row.id}`,
    ) as HTMLDetailsElement | null;
    if (details) details.open = true;
    details?.querySelector<HTMLElement>('[data-review-missing="true"]:not(:disabled)')?.focus();
  }
  return (
    <article
      className="assistant-extraction assistant-compact-card"
      tabIndex={-1}
      data-review-incomplete={row.included && !p.ready}
      aria-label={`Listing ${index + 1}`}
    >
      <div className="compact-listing-content">
        {row.facts.lines.map((line, i) => {
          const match = row.matches[i];
          const item = w.items.find((item) => item.id === match?.itemId);
          const potential = listingPotential(w, row, i, p.costs[i] ?? null);
          const raw =
            match?.costInput ?? (potential.cost === null ? '' : String(potential.cost / 100));
          const costError = listingAmount(raw).error;
          const locked =
            !!item && item.cost > 0 && !match.costCorrection && match.costOverride == null;
          const candidates = match?.newItem
            ? plausibleInventoryMatches(w, row.facts, line).filter(
                (c) => !c.exact && !match.dismissedCandidateIds?.includes(c.item.id),
              )
            : [];
          return (
            <div className="compact-listing-line" key={i}>
              <div className="compact-listing-heading">
                {imageUrl || source?.reference ? (
                  <ClothingPreview thumbnailOnly line={line} source={source} url={imageUrl} />
                ) : (
                  <div className="assistant-listing-thumbnail compact-no-photo">
                    <Shirt size={24} aria-hidden />
                  </div>
                )}
                <div className="compact-listing-title">
                  <strong>{line.title || 'Item title needed'}</strong>
                  <small>
                    <span
                      className={p.ready ? 'compact-ready' : 'compact-pending'}
                      aria-label={p.ready ? 'Ready' : 'Needs review'}
                    >
                      ●{' '}
                    </span>
                    {row.facts.marketplace || 'Choose marketplace'} ·{' '}
                    {line.price === null ? 'Price needed' : money(line.price)} asking
                  </small>
                </div>
              </div>
              <div className="compact-listing-cost">
                <label className="field">
                  <span>Purchase cost ($)</span>
                  <input
                    aria-label="Purchase Cost ($)"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={100}
                    disabled={busy}
                    onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
                    readOnly={locked}
                    value={raw}
                    placeholder="Unknown"
                    data-review-missing={!!costError || (!item && potential.cost === null)}
                    aria-invalid={!!costError}
                    aria-describedby={costError ? messageId : undefined}
                    onChange={(e) => onChange(changeListingCost(w, row, i, e.target.value))}
                  />
                </label>
                <div className="compact-listing-profit">
                  <span>Est. gross profit</span>
                  <strong>{potential.gross === null ? '—' : money(potential.gross)}</strong>
                  <small>
                    {locked
                      ? 'Stored cost'
                      : match?.costAllocation?.mode === 'split'
                        ? 'Batch split'
                        : match?.costAllocation?.mode === 'same'
                          ? 'Batch cost'
                          : ''}
                  </small>
                </div>
              </div>
              {!!candidates.length && (
                <div className="compact-match-exception">
                  <strong>Possible existing item</strong>
                  <div className="actions">
                    {candidates.map((candidate) => (
                      <Button
                        key={candidate.item.id}
                        size="sm"
                        variant="outline"
                        data-review-missing="true"
                        disabled={busy}
                        onClick={() =>
                          onChange({
                            ...row,
                            matches: row.matches.map((m, j) =>
                              j === i
                                ? {
                                    ...m,
                                    itemId: candidate.item.id,
                                    newItem: null,
                                    costInput: undefined,
                                    costOverride: undefined,
                                    costCorrection: false,
                                    purchaseCost: undefined,
                                  }
                                : m,
                            ),
                          })
                        }
                      >
                        Use {candidate.item.sku}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        onChange({
                          ...row,
                          matches: row.matches.map((m, j) =>
                            j === i
                              ? { ...m, dismissedCandidateIds: candidates.map((c) => c.item.id) }
                              : m,
                          ),
                        })
                      }
                    >
                      Create different item
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        className="compact-trash"
        aria-label={`Remove pending record ${index + 1}`}
        disabled={busy}
        onClick={onRemove}
      >
        <Trash2 size={15} />
      </Button>
      {row.included &&
        !p.ready &&
        !(p.issues.length === 1 && /purchase cost is unknown/.test(p.issues[0])) && (
          <button
            type="button"
            className="compact-listing-issue"
            data-review-issues
            id={messageId}
            disabled={busy}
            onClick={expand}
          >
            {listingNextAction(p.issues)}
          </button>
        )}
      <details className="compact-listing-details" id={`listing-details-${row.id}`}>
        <summary aria-label={`Edit listing ${index + 1} details`}>
          <ChevronDown size={18} />
        </summary>
        <div className="compact-expanded-fields">
          <small>
            {p.ready ? 'Ready' : 'Needs review'} ·{' '}
            {row.matches.some((m) => m.newItem)
              ? 'New inventory draft; created only on approval.'
              : 'Linked inventory.'}
          </small>
          {!row.included && (
            <Button size="sm" disabled={busy} onClick={() => onChange({ ...row, included: true })}>
              Include this listing
            </Button>
          )}
          <LifecycleFields row={row} w={w} busy={busy} onChange={onChange} />
          {row.facts.lines.map((line, i) => (
            <ListingFields
              key={i}
              compactReview
              row={row}
              index={i}
              w={w}
              busy={busy}
              previewCost={p.costs[i] ?? null}
              issues={p.issues}
              contextItemId={contextItemId}
              pendingItems={pendingItems}
              onChange={onChange}
            />
          ))}
          {p.duplicateId && p.duplicateKind === 'listing' && (
            <Button size="sm" variant="outline" onClick={() => onView('listing', p.duplicateId!)}>
              View existing listing
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onChange({ ...row, included: false })}
          >
            Skip
          </Button>
          <details>
            <summary>Source evidence and diagnostics</summary>
            {row.facts.lines.map((line, i) => (
              <ClothingPreview key={i} line={line} source={source} url={imageUrl} />
            ))}
            {p.issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
            {row.facts.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </details>
        </div>
      </details>
    </article>
  );
}
