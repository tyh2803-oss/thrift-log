import type { Workspace } from './model';
type Receipt = Workspace['imports'][number];
type CachedAudit =
  | { raw: string; ok: true; value: ReturnType<typeof JSON.parse> }
  | { raw: string; ok: false; error: unknown };
const audits = new WeakMap<Receipt, CachedAudit>();

/** Read-only provenance. Never mutate the result; edits must replace rawCsv.
 * Cache parsing only, not cost/authorization decisions. Raw text changes invalidate
 * even an in-place receipt edit, and discarded/account-switched receipts can be GC'd.
 */
export function readImportAudit(receipt: Receipt) {
  const cached = audits.get(receipt);
  if (cached?.raw === receipt.rawCsv) {
    if (cached.ok) return cached.value;
    throw cached.error;
  }
  try {
    const value = JSON.parse(receipt.rawCsv);
    audits.set(receipt, { raw: receipt.rawCsv, ok: true, value });
    return value;
  } catch (error) {
    audits.set(receipt, { raw: receipt.rawCsv, ok: false, error });
    throw error;
  }
}
