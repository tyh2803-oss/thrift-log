'use client';
import { useState } from 'react';
import type { DraftBatch } from '@/lib/assistant/drafts';
import { listingAmount } from '@/lib/assistant/listing-review';
import { Button } from './ui/button';

export function HistoryBatchFields({
  batch,
  onChange,
  busy,
}: {
  batch: DraftBatch;
  onChange: (batch: DraftBatch) => void;
  busy: boolean;
}) {
  const [date, setDate] = useState('');
  const [fee, setFee] = useState('');
  const [notice, setNotice] = useState('');
  const amount = listingAmount(fee);
  const missingDates = batch.rows.filter((r) => r.included && !r.facts.date).length;
  const missingFees = batch.rows.filter((r) => r.included && r.facts.fees === null).length;
  if (!missingDates && !missingFees && !notice) return null;
  return (
    <fieldset className="card history-batch-fields" disabled={busy}>
      <legend>Fill missing information in bulk</legend>
      <p>
        Applies only to included drafts with missing values. Existing values and saved records stay
        unchanged.
      </p>
      <div className="form-grid">
        {!!missingDates && (
          <div className="field">
            <label htmlFor="history-batch-date">Sale date · {missingDates} missing</label>
            <input
              id="history-batch-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!date}
              onClick={() => {
                onChange({
                  ...batch,
                  rows: batch.rows.map((row) =>
                    row.included && !row.facts.date
                      ? {
                          ...row,
                          facts: { ...row.facts, date },
                          matches: row.matches.map((match) => ({
                            ...match,
                            newItem: match.newItem?.assumedAcquisitionDate
                              ? { ...match.newItem, purchasedAt: date }
                              : match.newItem,
                          })),
                        }
                      : row,
                  ),
                });
                setNotice(`Filled ${missingDates} missing sale dates. Review before approval.`);
              }}
            >
              Fill missing dates
            </Button>
          </div>
        )}
        {!!missingFees && (
          <div className="field">
            <label htmlFor="history-batch-fees">
              Total seller fees per sale ($) · {missingFees} missing
            </label>
            <input
              id="history-batch-fees"
              inputMode="decimal"
              value={fee}
              placeholder="Unknown — enter 0 only for no fees"
              aria-invalid={!!amount.error}
              onChange={(e) => setFee(e.target.value)}
            />
            {amount.error && (
              <small role="alert" className="error-text">
                {amount.error}
              </small>
            )}
            <small>This is the amount for each sale, not a batch total.</small>
            <Button
              variant="outline"
              disabled={amount.value === null || !!amount.error}
              onClick={() => {
                onChange({
                  ...batch,
                  rows: batch.rows.map((row) =>
                    row.included && row.facts.fees === null
                      ? { ...row, facts: { ...row.facts, fees: amount.value, processing: 0 } }
                      : row,
                  ),
                });
                setNotice(
                  `Filled ${missingFees} missing seller fee totals. Review before approval.`,
                );
              }}
            >
              Fill missing fees
            </Button>
          </div>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
    </fieldset>
  );
}
