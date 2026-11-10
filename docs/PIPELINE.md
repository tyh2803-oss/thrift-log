# Inventory Pipeline

Home shows a current operational snapshot of physical inventory: **Unlisted → For Sale → Sold → Shipped**. Reporting-period filters do not change it. Click a stage to open the existing Inventory or Sales view with a persistent URL filter. Clear the filter to return to the ordinary view. No new navigation page or separate lifecycle records are created.

The shared **Cost | Sale Value | Profit** control defaults to Sale Value and remembers the selection in this tab's session storage. Changing it only changes presentation; it never sends a save request. Item counts remain visible. Settings can hide the widget and optionally configure an estimated selling expense per physical item.

## Stage precedence

Each physical item appears at most once:

1. Archived items are excluded from the operational snapshot and remain in existing history.
2. A completed sale with no physical return takes precedence over stale inventory status and active cross-listings. Its item is Sold while unfulfilled, or Shipped when shipped, delivered or handed over. Multiple conflicting current sales are held for lifecycle review rather than counted twice.
3. Otherwise an active marketplace listing places the item in For Sale. Multiple listings still represent one physical item. A Whatnot show reservation alone does not imply a listing; a secondary count identifies reserved pieces.
4. A returned item without an active listing waits for restocking outside the four stages. Explicitly changing its inventory status to Ready to List (or another available state) re-enters Unlisted; a new active listing re-enters For Sale. A cancellation restores the available position using actual listing state. Existing commands close obsolete listings rather than automatically republishing them.
5. Remaining unsold, nonarchived inventory is Unlisted. An orphan Sold status without an authoritative sale is held for review.

Refunding money alone does not restore physical stock. Existing dated physical-return and reversal rules determine availability. A resold piece is represented by its current sale cycle; earlier sale/refund history stays in the financial reports. The pipeline is not a lifetime-profit report and does not add incomparable stage values into a grand total.

## Monetary values

All amounts use integer cents. Original order postings and dated adjustments use the existing ledger and largest-remainder allocation, including shared fees, discounts, refunds, shipping and grouped-package label allocations. The widget does not independently deduct package labels or separately recorded operating expenses.

| Metric | Unlisted | For Sale | Sold / Shipped |
| --- | --- | --- | --- |
| Cost | Current acquisition cost | Current acquisition cost, once per piece | Original sale-line cost basis |
| Sale Value | Explicit expected asking price | Lowest positive active listing price per piece; fallback to explicit item asking price | Net current-cycle merchandise sales after recorded discounts/refunds |
| Profit | Potential Profit | Potential Profit | Realized Profit or Provisional Profit |

Potential Profit requires an explicit positive expected/asking price, known acquisition cost and a configured per-item estimated selling expense. The estimate is entered in **Settings → Preferences**; blank means unknown, and an explicit $0 is allowed. It represents the user's combined estimated selling costs, not an inferred marketplace fee schedule. Missing inputs are excluded from the monetary subtotal with an **incomplete** count; all physical items remain counted. If no item has sufficient information, the display is unavailable (`—`). Empty stages display $0.

Realized item profit is the existing ledger's allocated seller revenue minus COGS and direct costs, including recorded buyer shipping/tips as income and recorded selling expenses. Negative profit is retained. Old orders cannot establish whether a stored zero charge was known or omitted, so their profit stays provisional until the user explicitly confirms purchase costs and all selling amounts in the order editor or **Item fulfillment** dialog. Approved assistant sales with complete amounts are confirmed automatically. Missing zero purchase cost is treated conservatively unless explicitly confirmed or supported by assistant provenance; the pipeline does not alter stored values.

Merchandise sale value excludes buyer shipping and tips. Where an order has those other income amounts and refunds/revenue adjustments whose merchandise attribution cannot be established, merchandise value is unavailable instead of guessed. Ledger profit remains available when its inputs are known. Asking/expected values and Potential Profit are estimates, never earned revenue.

## Fulfillment

Sales → Orders → **Item fulfillment**, or a pipeline sales row's **Manage fulfillment**, can mark individual pieces Unfulfilled, Shipped, Delivered or Handed over. This supports partial fulfillment without moving an entire multi-item order prematurely. Delivered pieces stay fulfilled. Handed-over and legacy fulfilled in-person pieces are identified explicitly within the requested Shipped stage.

Orders with a whole-order package continue to use **Sales → Shipments**. Item overrides are disabled for those orders; orders with item-level overrides cannot join a whole-order package until their item states are reset. A partial order's parent fulfillment stays Unfulfilled until all lines are fulfilled. Fulfillment changes do not add shipping expenses. Completion timestamps are recorded for new item actions; older order-level completion dates remain unknown rather than invented.

Changes go through the existing validated command layer, revision checks and transactional Supabase RPC. Schema version 4 adds only optional item-fulfillment/amount-confirmation metadata on existing orders. Old payloads preserve that metadata. No financial history or lifecycle counts are stored redundantly.

## Verification and limits

Automated coverage includes cross-listing, stage transitions, all three metrics, unknown estimates/costs, exact-cent multi-item allocations, partial refunds, negative profit, partial/grouped fulfillment, handovers, cancellations, returns, resale, show reservations, assistant sale/listing approvals, URL filters, widget preferences and desktop/mobile layouts. See [PROJECT_STATUS.md](../PROJECT_STATUS.md) for checks actually run and hosted migration versions.

For the opt-in hosted assistant regression, use `HOSTED_BROWSER=chromium` and, when needed, `HOSTED_CHROMIUM_EXECUTABLE=/path/to/chrome` with `scripts/verify-assistant-hosted.mjs`. Its default is WebKit. The latest WebKit attempt encountered a local pointer-automation failure at sign-in; the complete real hosted flow passed in Chromium. See the status log for precise evidence.

The widget uses the loaded workspace without new network aggregation calls. Browser mobile checks emulate an iPhone viewport; physical iPhone/PWA acceptance remains outstanding. Historical as-of reconstruction, item-level split packages and automatic marketplace fulfillment synchronization are not implemented. Existing date-filtered financial reports remain the source for historical performance.
