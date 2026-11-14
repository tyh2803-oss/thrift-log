# Import review and bulk purchase costs

Prepared on `fix/whatnot-review-and-bulk-costs`. The user authorized code deployment; saved-sale cost changes stay capability-gated until the separate migration is approved. The migration below has **not** been applied to production.

## Why Whatnot orders were held

A read-only diagnosis found 114 cached orders held by possible inventory matches, two with totals that did not reconcile, and one giveaway needing confirmed purchase cost. Another 249 orders were already recorded. Generic repeated titles and reused SKUs were triggering the match gate, including against already-sold stock. Financial reports were not available in the cached source, so seller fees and profit were still incomplete independently of these holds. These are aggregate counts at diagnosis time, not a claim that every account had the same records.

Imports no longer reject or silently skip records because of similar names, repeated source identifiers, identical files or previously imported rows. Every supported extracted record reaches review. New internal IDs keep separately approved records distinct; original source identifiers stay in provenance/audit records. Existing inventory links and explicit links between pending cross-listings remain available, but matching is optional. A unique available exact match can still reuse existing stock; a reused SKU that identifies no single available piece produces a new physical draft.

Retry receipts, revision checks and stable Whatnot seller/order/unit IDs remain. Retrying the same submitted operation or periodically synchronizing the same provider order updates that operation rather than posting it twice. Deliberately importing a file again creates another approved import. Actual monetary, date, currency, ownership, source-status and physical-return validation remains in place; disabling similarity gates does not make conflicting totals trustworthy.

## Import held Whatnot orders

Old matching-only holds are automatically retried during the existing authorized read-only sync, in bounded batches of 20. No individual matching decisions are needed. Financial or giveaway exceptions are not silently accepted. For manual retry or optional bulk costs:

1. Open Settings → Marketplace connections → **Review Whatnot updates**.
2. **Select all orders**, then **Import selected**. No per-item duplicate-confirmation checkbox is needed. Up to 200 pending updates are displayed, processed in chunks of 50 with atomic commits per chunk. Successful orders leave the queue; failures remain selected and show short explanations. A concurrent sync may require retrying the remainder.
3. Optionally expand **Bulk purchase costs for new items** before importing. Set the same cost per physical item or split a total into exact cents. This only sets pending new items; saved inventory costs are protected. Blank stays unknown and entered $0 is confirmed free inventory.

Ordinary sales may be recorded with unknown purchase costs or missing seller fees; profit remains incomplete. Giveaways still require a confirmed cost and zero merchandise proceeds. Genuine totals/refund inconsistencies need corrected source facts. Generate any necessary seller financial report in Whatnot, then refresh Thrift Log; the read-only API cannot create reports or invent fees.

## Add purchase costs to saved records

Use **Bulk purchase costs** in Inventory or Sales, including the Listings tab, or **Set purchase costs** for selected inventory. The dialog counts unique physical items across cross-listings and orders, not listing rows.

- Same cost per item, split total cost, or individual entry. Exact-cent remainders are allocated deterministically in the displayed selection order. Individual overrides remain in place when changing modes or expanding other details.
- Unknown-cost items are selected initially. Recorded costs require **Allow corrections to recorded purchase costs** before selection. Blank is unknown; explicit $0 confirms free inventory.
- **Apply purchase costs** is the explicit final approval. A failed request retains the batch for a safe retry. At most 200 physical items are applied atomically.
- Current inventory costs are updated. Saved sales receive separate audited **Cost basis adjustment** events at their original sale dates, so historical profit is restated accurately. Original sale lines and posted events are retained unchanged. Corrections affect COGS, not revenue, fees, payouts or cash proceeds. Returns reverse the corrected cost; a returned and resold piece is not expensed twice. Further corrections append another delta rather than reversing the correction event through the generic financial editor.

## Other interaction changes

The home dashboard leads with two primary financial cards, a compact labor row and the four-stage pipeline. Marketplace breakdowns, planning and goals expand on demand. Tab content paints immediately from the owned in-memory workspace while fresh server authorization proceeds; private APIs retain all access checks.

The pipeline dialog now has a sticky top **Save changes** button as well as its bottom save action. Both use the same validation, confirmation, retry and saving state. Moving already-sold items to Shipped no longer displays irrelevant new-sale defaults.

User messages, assistant responses and proposed changes have separate labeled borders. Suggested replies have a prominent bordered panel beside the composer, outside the scrolling conversation. They clear when answered or their associated proposals have been approved.

## Minimum safe rollout

The additive migration is [202611130002_purchase_cost_corrections.sql](../supabase/migrations/202611130002_purchase_cost_corrections.sql). It requires existing schema 6 or 7. It adds a nullable cost target, a financial event kind, an owned-sale foreign key, validation triggers, a service-only capability helper and guarded additions to the existing private commit function. It preserves Auth UUIDs, beta access, inventory, original financial postings, photos, RLS, private storage and revision locks. Compatibility and preservation are checked in isolated PostgreSQL-compatible tests, not by applying it to production.

**Code deployment is authorized; production migration application still requires separate explicit approval.** The deployed app safely refuses saved-sale cost changes until the migration is installed. After database approval:

1. Retain a database backup and inspect migration history. Apply only this new file once through the existing Supabase SQL Editor/migration workflow; it is transactional. Do not replay earlier migrations. Reload the PostgREST schema if the SQL Editor workflow does not do so.
2. Verify the service-only `purchase_costs_ready()` helper returns true and existing readiness/isolation checks remain valid. Unauthenticated/client execution must remain denied.
3. Deploy the checked code through the existing GitHub/Vercel workflow. No new credentials, SMTP, buckets or Auth settings are needed. Test a small, intentionally chosen cost batch and compare COGS/profit with the entered amounts.

Until the migration is installed, saved-sale cost changes return a clear setup message without writing anything. Unsold inventory cost entry and other UI/import improvements use the existing schema. After new cost events have been posted, do not roll back to an older application that cannot read the new event kind; roll forward with compatible code or an explicitly reviewed recovery plan. No production business records were changed during development or testing. Physical iPhone Safari/PWA and real provider acceptance remain manual; browser automation uses Chromium desktop and iPhone-sized emulation, local API doubles, and isolated database tests.
