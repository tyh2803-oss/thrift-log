# Marketplace capabilities and limitations

No live marketplace account is connected. The adapter registry in `src/lib/integrations/adapters.ts` declares implemented capabilities explicitly. Manual listing/sale records and mapped inventory/listing/sales CSV imports work for Whatnot, eBay, Depop, and Vinted. This is not automated external synchronization.

## Whatnot

Official documentation requested: https://developers.whatnot.com/ (including an attempted `llms.txt` request). Access returned HTTP 403 through the environment's egress path on November 9, 2026. The specification's Seller API assertions, endpoints, token model, scopes, pagination, rate limits, report formats, and webhook support therefore remain unverified here. No guessed API endpoints, auth flows, webhook event names, or signature schemes were implemented.

Available now: manual show scheduling, inventory reservations/lineup, presented flag, starting bids, checklist, sales association, giveaways/tips, refunds/fee credits, show expenses, labor associations, show profit, live-hour versus total-labor earnings, and exact-SKU mapped CSV sales import with stable order IDs and original-file audit.

Next: obtain documentation access, verify PAT support and the approved seller's scopes, implement a read-only client with documented pagination/retry limits, add contract tests from official response shapes, and only then enable a secure server-side connection. Account-specific official reports should have tested mappings before claiming native report support. Token replacement/disconnect controls, automatic product/order/show imports, API analytics, shipment grouping, payout ledger, webhooks, and external writes are pending. Read/write capabilities are not shown as connected.

## eBay

Official developer documentation requested: https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders. It also returned a proxy HTTP 403. Official OAuth app configuration, seller authorization, scopes, and read-only listing/order clients remain pending. CSV and manual workflows are available.

## Depop and Vinted

No current authorized API access was verified. Use CSV/manual workflows. There is no scraping, credential collection, or external listing mutation. A sale flags cross-listed records as Needs delisting; the owner must actually remove the listing externally and then end the internal listing record.

## Reconciliation

Identity is marketplace plus stable order/listing ID, with explicit SKU-to-physical-item matching. Overlapping reports skip existing orders. Corrections require editing the existing transaction; importing a changed file cannot quietly overwrite it. Fee fields are per row. Unsupported ledger/report semantics must be reconciled before import, not guessed. Orders, shipments, and payouts are not treated as interchangeable.
