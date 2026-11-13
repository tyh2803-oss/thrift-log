# Marketplace capabilities and limitations

The adapter registry in `src/lib/integrations/adapters.ts` declares implemented capabilities explicitly. Manual listing/sale records and mapped inventory/listing/sales CSV imports work for Whatnot, eBay, Depop and Vinted. Whatnot additionally has a per-user read-only Seller API connection, gated on the additive migration and each seller's authorization. No live account was connected during implementation.

## Whatnot

See [Whatnot setup, security and API limits](WHATNOT_INTEGRATION.md). The official OpenAPI v2.0.0, PAT scopes, cursor pagination, rate limits, completed financial reports and Standard Webhooks signature contract were verified against the public documentation. Server-only encrypted credentials, resumable history and ongoing synchronization, exact inventory matching, safe review, fulfillment, shows and separate platform analytics are implemented. No external writes or customer scopes are used.

Fees require completed financial reports generated in Whatnot. Unsupported net refund breakdowns require explicit reconciliation. The documented API has no payout-transfer endpoint, so bank payouts remain manual. Missing seller charges and unknown purchase costs keep profit incomplete. Existing manual show, lineup, giveaway, refund, labor and CSV workflows remain available. Production migration and live seller verification are still operator steps.

## eBay

Official developer documentation requested: https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders. It also returned a proxy HTTP 403. Official OAuth app configuration, seller authorization, scopes, and read-only listing/order clients remain pending. CSV and manual workflows are available.

## Depop and Vinted

No current authorized API access was verified. Use CSV/manual workflows. There is no scraping, credential collection, or external listing mutation. A sale flags cross-listed records as Needs delisting; the owner must actually remove the listing externally and then end the internal listing record.

## Reconciliation

Identity is marketplace plus stable order/listing ID, with explicit SKU-to-physical-item matching. Automatic Whatnot synchronization deduplicates stable source IDs; the explicit sale-history CSV/PDF flow still permits intentional reimports as requested. Corrections preserve original dated postings. Generic mapped CSV fee fields are per row. Unsupported ledger/report semantics must be reconciled before import, not guessed. Orders, shipments, and payouts are not treated as interchangeable.
