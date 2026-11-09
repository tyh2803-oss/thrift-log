# Calculation definitions

All stored monetary values are safe integer cents. UI/import dollar strings are parsed without floating-point multiplication. Shared costs use largest-remainder allocation, preserving the exact total; ties follow item order. Displayed rates can be fractional cents before currency formatting.

## Realized results

For an active (Completed or Returned) order:

- Merchandise gross = sum of physical item final sale prices.
- Seller revenue = gross − discounts + buyer shipping + tips − actual refunds + signed revenue adjustments.
- COGS = original cost snapshots of completed order items. Returned and Cancelled orders reverse COGS.
- Fees = marketplace fees + processing − explicit fee credits.
- Direct costs = fees + seller shipping + packaging + other direct costs.
- Realized item/order profit = seller revenue − COGS − direct costs.
- Period net operating profit = original order postings dated in that period + dated adjustment postings in that period − separately recorded operating expenses dated in that period.
- Margin = operating profit ÷ positive seller revenue; otherwise 0%.

Cancelled orders recognize no merchandise, shipping, tips, or refund revenue (avoids subtracting a canceled payment twice). They retain actual direct costs and signed adjustments until corrected. Use Completed for partial refunds. Returned restores all physical inventory in an order; record the actual refund and fee credits separately. These original-order fields remain a legacy correction path. For new corrections use Sales → Orders → Adjustments & returns, which preserves event dates and supports individual physical returns.

Changing an inventory item's current purchase cost does not rewrite historical sale cost snapshots. Editing an existing sale cannot silently change its physical item allocation or cost basis. Financial order and line changes are audited in PostgreSQL. Legacy cumulative refund fields retain their original interpretation and can restate an original sale before a dated ledger exists. Once any dated event is posted, the order financial basis and its line prices/cost snapshots are locked. Fulfillment and payout metadata remain editable through their appropriate workflow. New corrections append a dated event or its reversal; they never rewrite posted history. This is an operational accounting ledger, not a full accrual/tax filing system.

Giveaways have zero merchandise revenue, consume physical stock, and deduct their costs. Tips can be separate transactions, have no physical stock, and do not increase units sold. They do increase seller revenue and profit. Merchandise averages must not count standalone tip transactions as items.

Multi-item net proceeds are allocated using final sale prices as weights. A zero-priced lot uses equal weights. Brand/category/source item profits exclude general operating expenses. The show report deducts expenses specifically linked to that show. A cost should appear either on an order or as an expense, never both.

## Inventory and purchases

Current inventory cost and asking value include each unsold, nonarchived physical item once. Asking value uses the item's selected asking price; it does not sum marketplace listings. Reserved show stock remains owned inventory. Ending a show releases unsold stock without recording a sale.

Inventory purchases are assets until sold. Trip `totalSpent` is an informational cash-spending record; item cost basis is assigned separately, including an exact-cent split for identical batch items. Differences between trip spend and assigned costs are visible. Trip spending is not deducted again as an operating expense. Full bank cash-flow and inventory adjustment ledgers remain pending.

## Time and earnings

Timer intervals contain ISO timestamps; paused gaps are excluded. Only one Running/Paused timer is permitted. Total labor merges overlapping ranges and clips them to the selected reporting period, so shared time is not double-counted. Category totals merge within their category; if manual sessions of different categories overlap, category totals can exceed total hours.

- Period earnings/hour = period net operating profit ÷ labor during that same period.
- Project/show earnings/hour = all recorded project profit (including linked expenses) ÷ all explicitly linked labor.
- Livestream earnings/hour = show profit ÷ separately recorded stream minutes.

A recorded stream duration is not added to labor automatically. Zero-hour earnings are shown as unavailable, not zero or infinity. Trips and source reports are realized-so-far; unsold potential is not earned income. Precise marketplace hourly comparisons require explicit labor attribution and are not inferred.

Calendar reporting boundaries use the configured IANA timezone, including daylight-saving changes. Inventory is a current snapshot even when the transaction filter is historical. Multi-currency conversions are deliberately not supported; the current ledger is USD.

## Dated adjustments, physical returns, and cash

A Refund event reduces seller revenue on its event date. A Fee adjustment increases fees for positive amounts and credits fees for negative amounts. A Revenue adjustment changes seller revenue by a signed amount. A Direct cost adjustment changes direct costs (Shipping, Packaging, or Other) by a signed amount.

A Refund may include selected physical pieces; Return restores selected pieces without paying a refund. Only those pieces recover their original cost snapshots, on the return date, and become available for resale. The rest of a multi-item order stays sold. A subsequent resale incurs its own COGS snapshot. Giveaways can be physically returned without creating paid units. An event cannot return a piece twice or precede the sale. A resale cannot predate its recorded return.

Reversal events append the opposite financial and inventory effect on their own dates. A posted event is immutable and can be reversed once. A physical return cannot be reversed after that piece has been resold. Cumulative refunds cannot exceed customer revenue, and fee credits cannot exceed recorded fees. Reversals must leave these constraints valid.

A refund associated with returned pieces is allocated to those pieces by their original prices. A refund with no physical return uses all original line prices. Costs/credits are allocated using the original price weights, with equal allocation for zero-priced lots. Original sale units and net return units remain distinct. Merchandise average selling price uses original merchandise less allocated discount and excludes buyer shipping, tips, and subsequent refunds.

Actual payout receipts are immutable dated cash entries allocated exactly to orders. They do not add revenue or profit. Partial receipts reduce outstanding net proceeds; a receipt reversal restores that balance without deleting history. Legacy manual Paid flags are preserved as reconciliation metadata and do not create cash receipts. Once receipt allocations exist, remaining proceeds determine the displayed payout status. Later refunds can make previously received cash exceed current proceeds; bank clawback/partial debit reconciliation is still pending.

The dated Ledger CSV exports each line allocation once, operating expenses separately, and payout cash in a separate column with zero operating profit. Summing operating_profit therefore matches the selected period P&L, while cash_receipt totals recorded receipts. Sales CSV exports one row per filtered order, preventing duplicated order totals on multi-item lines.

## Grouped shipments

A package groups explicit orders from one marketplace; it does not merge their sales or represent buyer matching. Each order belongs to one package in this initial workflow. Saving status updates linked order fulfillment. A package's order membership is fixed after creation; package cancellation/splitting is future work.

A label cost is informational until the user explicitly posts its allocation. Posting splits exact cents by original merchandise price totals and appends dated Shipping cost events. It is rejected when order shipping has already been recorded. Merely linking a package, editing tracking/status, or reloading never deducts the label again. Corrections to an allocated label use ledger events rather than rewriting the posted amount. No shipment label amount is independently included in P&L.

Pending proceeds are not a verified bank balance or marketplace remittance. Marketplace and bank synchronization remain separate pending integrations.
