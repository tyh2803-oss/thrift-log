# eBay read-only connection

Implemented on `feat/ebay-seller-connection` from the existing `96cc135` application. **Included in the owner-approved application release. The production database migration remains unapplied and live account setup is pending.** Existing Whatnot, AI approval, manual/CSV workflows, owner records and private photos remain intact.

## Minimum setup in the existing projects

1. Create an [eBay Developers Program account](https://developer.ebay.com/signin). In **Application Keys**, create a **Production** keyset. Developer membership/key activation may need eBay approval; an ordinary seller login alone is insufficient. Keep the Client Secret private. Configure an appropriate public application privacy policy and the required marketplace account-deletion notification subscription described below. This cannot be completed without the owner's developer account.
2. In the keyset's **User Tokens / Sign in with eBay** settings create an OAuth redirect entry. Set the accepted URL to **`https://thrift-log.vercel.app/api/integrations/ebay/callback`** and the declined URL to the same callback (the app handles an error response safely). Copy its generated **RuName**, not the callback URL, into `EBAY_REDIRECT_URI_NAME`. Enable the two supported core scopes `commerce.identity.readonly` and `sell.fulfillment.readonly`. If a scope is not available in your keyset, request access through eBay developer support; Thrift Log does not silently expand permissions.
3. After reviewing the code and approving production setup, apply **only [202611150001_ebay_read_only.sql](../supabase/migrations/202611150001_ebay_read_only.sql)** once in the existing Supabase project's SQL Editor/migration workflow. It requires beta authorization/schema 6 or 7 and does not depend on the Whatnot migration. It adds private connection, one-use OAuth state, source-record and deletion-event tables plus one service-only RPC. It changes no business schema version, Auth UUIDs, beta access, business records, financial definitions or existing photo policies. Do not replay existing migrations or run an indiscriminate database push.
4. Add these **server-only** Vercel environment variables and deploy the approved feature:

   | Variable | Value |
   | --- | --- |
   | `EBAY_CLIENT_ID` | Production App ID / Client ID |
   | `EBAY_CLIENT_SECRET` | Production Cert ID / Client Secret |
   | `EBAY_REDIRECT_URI_NAME` | The generated OAuth RuName |
   | `EBAY_APP_URL` | `https://thrift-log.vercel.app` (origin only) |
   | `EBAY_ENVIRONMENT` | `production` (default) |
   | `EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN` | Random 32–80 characters using letters, numbers, `_` and `-`; use the same value in eBay's notification settings |

   Existing Supabase variables are reused. Existing `CRON_SECRET` (at least 32 characters) enables the added daily eBay job at 10:15 UTC; foreground sync also works without cron. Never use a `NEXT_PUBLIC_` prefix or paste keys into chat/source control.
5. Each authorized tester opens **Settings → Marketplace connections → eBay → Connect eBay**, signs in on eBay and approves access. They return to their own Thrift Log workspace. History imports in resumable batches. Leave the app open or use Refresh eBay to continue. No seller password or user token is pasted into Thrift Log.

No additional database project or dependency is required. Production migration, environment changes and deployment remain operator/approval steps. Rollback application code or disconnect to stop sync; keep additive tables and financial records rather than dropping business data.

## Optional financial access

Order-only access already imports actual sales and confirmed fulfillment. **Fees remain incomplete until supported verified financial data is available**; absent amounts are not confirmed zero.

To enable transactions, seller fees, shipping-label charges, refunds and bank payouts, have eBay enable **`https://api.ebay.com/oauth/api_scope/sell.finances`** on the production keyset, set `EBAY_ENABLE_FINANCES=true`, redeploy, then choose **Connect with financial data**. Existing users must grant the extra scope; changing the environment flag does not grant account permissions.

**eBay does not expose a general read-only Finances scope.** Its consent label includes broader payment/refund permissions, but this implementation calls only fixed GET financial endpoints. It has no endpoint/client operation to create a listing, change an order, issue a refund or initiate a payout. Core order scope is strictly read-only.

EU/UK sellers may require eBay Digital Signatures for Finances requests. Digital Signature key provisioning/signing is **not implemented** in this release; a financial 403 produces an explicit financial-access notice while order imports continue. The default USD workspace does not convert foreign currencies. Restricted order-earnings endpoints, which need additional growth approval, are not used.

## Required account-deletion notification

In the keyset's **Alerts and Notifications → Marketplace Account Deletion**, subscribe using:

- Endpoint: **`https://thrift-log.vercel.app/api/integrations/ebay/notifications`**
- Verification token: the same `EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN` stored securely above.
- Appropriate owner notification/contact email in eBay's developer dashboard.

The endpoint answers eBay's SHA-256 verification challenge and validates notifications against official eBay ECC/SHA1 public keys obtained using an application token. Keys are temporarily cached; unknown-key lookups are bounded. Unsigned/tampered messages cannot disconnect an account. A verified event removes that seller's integration credentials, retained provider-source records and OAuth state, fences in-flight saves, and stores only a hashed delivery ID for replay handling. It also works after beta revocation. Buyer names, addresses, emails, bank account information and free-text customer notes are never retained by this integration.

**Saved business ledger records are retained**, as with ordinary disconnect; this handler does not erase inventory, taxes/fees or financial history. Those records and import receipts can include external order/account references. The owner must review eBay's data-handling/retention requirements and their privacy policy for these retained business records before enabling production access. The notification handler is not a claim that all retention obligations are automatically satisfied. eBay may keep new production keys inactive until this subscription is verified. Do not claim exemption merely because the app uses read-only API calls.

## Data and accounting behavior

- Initial backfill covers the API's accessible order history (just under two years), in fixed 30-day windows and bounded pages. New passes query modified orders with an overlap; transactions/payouts keep a separate last-successful financial checkpoint. Enabling or restoring finance access later backfills older charges instead of inheriting a recent orders-only sync time. Default unfiltered 90-day behavior is not used. Checkpoints and sources commit atomically with the workspace. Interrupted calls retain the last confirmed page. Dense windows are split before eBay offset limits; unsupported source pages fail clearly rather than silently skipping rows.
- Every physical quantity gets a stable actor/environment/seller/order/line/unit identity. Repeated titles or SKUs do not block new stock. A unique available exact SKU or linked eBay item ID may reuse existing owned inventory, preserving its cost/photos. Ambiguous similarity is not a routine confirmation gate. Existing provider IDs still make retries safe: one order is not reimported on every poll.
- Actual line totals split in exact cents. Seller discounts, shipping received and eBay-collected taxes must reconcile to the order total. Marketplace tax is excluded from seller revenue. Unsupported seller tax/special charges/adjustments are held for reconciliation. Unpaid orders do not become completed sales. Estimated asking prices never become actual proceeds.
- Known acquisition costs remain intact. Missing purchase costs stay unknown; explicit zero is free. Imported new historical items use a visibly documented sale-date storage placeholder for unknown acquisition dates. Existing bulk purchase-cost review/corrections work for eBay records without rewriting original sales.
- Confirmed shipping dates update canonical item fulfillment; a label or `FULFILLED` string without a date is insufficient. Split quantities map across fulfillment packages. Existing delivered/handed-over states and manually grouped packages are preserved. No external delisting is performed.
- Financial SALE transactions reconcile net seller amounts and post verified fees on the actual transaction date. Postage charges/credits use their dated transactions. Changed already-posted money is held, never silently rewritten. Unknown/unsupported charges/disputes keep financial completeness pending.
- eBay's net refund amount is not enough to infer its seller-funded gross refund and fee-credit split. Review accepts those actual values only when they reconcile exactly. Refunds never imply a physical return. Line-level physical returns stay in the existing correction workflow.
- Only successful bank payouts become cash receipts. Auto-allocation requires the complete source transaction count, posted transactions, positive per-order allocations and exact agreement with the bank amount. Otherwise the review offers exact order allocation. Payouts never add sales revenue. Reversed/failed payouts and express-payout fee accounting require manual reconciliation; they are not guessed.
- Dashboard, pipeline, exports, Insights and the assistant use provider-neutral completeness checks. Whatnot behavior stays supported. Missing eBay financials cannot masquerade as complete profit.

## Security and operational boundaries

Connection/records/state tables are RLS-enabled with no browser grants or policies. Only a service-role RPC accesses them. It derives membership from the verified caller, rechecks current beta authorization, locks revocation/connection state, and uses leases plus workspace revisions for atomic writes. OAuth state is random, hashed in the DB, actor-bound, one-use, ten-minute expiry, and matched to an HttpOnly/Secure/SameSite cookie. Attempts are durably limited per account. Disconnect invalidates pending grants and in-flight sync. Credentials never enter browser storage, response payloads or app logs.

Access/refresh tokens are AES-256-GCM encrypted with actor/provider/purpose authenticated data. The default domain-separated key derives from the existing service-role key. Optionally set a 64-hex-character **`EBAY_TOKEN_ENCRYPTION_KEY` before connecting** to make encryption independent of Supabase key rotation. Changing the encryption root requires reconnecting affected users. OAuth authorization/token endpoints are fixed by environment; arbitrary next-page URLs, response redirects and arbitrary API writes are rejected. Sandbox must use a separate intended test workspace/deployment; do not point it at live business records.

Foreground polling mounts once per authenticated workspace and continues backfills while visible; it does not restart on navigation. Sync normally becomes due after five minutes. The daily cron uses the existing secret and bounded authorized-user selection. Large histories may need several continuations or leaving the app open. Manual refresh, last full sync, progress, error and exception states are visible. There is no eBay sales webhook subscription in this version; polling covers order updates. Account-deletion notifications are independent and mandatory.

## Verification and remaining live checks

Automated checks use synthetic official-shaped responses, isolated Auth/database doubles and local PostgreSQL. They cover OAuth/CSRF/denial/replay, rate limits, encryption and tenant isolation, schema-6/7 owner preservation, atomic rollback/leases/revocation, exact financial math, tax exclusion, costs/zero, physical quantities, fulfillment, refund/payout handling, source sanitization, resumable polling and mobile/desktop UI. Final results are recorded in PROJECT_STATUS.md.

**No live developer keyset or authorized seller is available yet.** Production scope eligibility, actual consent/callback, financial API availability, deletion subscription verification and physical iPhone Safari/PWA acceptance need the owner's setup and an authorized seller. No production migration/data/Auth/Storage changes or external account operations are performed during development.

## Official references

Verified November 15, 2026:

- [OAuth authorization-code flow](https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html)
- [User identity](https://developer.ebay.com/api-docs/commerce/identity/resources/user/methods/getUser)
- [Orders](https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders)
- [Shipping fulfillment](https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/shipping_fulfillment/methods/getShippingFulfillments)
- [Financial transactions](https://developer.ebay.com/api-docs/sell/finances/resources/transaction/methods/getTransactions)
- [Payouts](https://developer.ebay.com/api-docs/sell/finances/resources/payout/methods/getPayouts)
- [Mandatory marketplace account-deletion notifications](https://developer.ebay.com/marketplace-account-deletion)
- [Official notification signature verification reference](https://github.com/eBay/event-notification-nodejs-sdk/blob/main/lib/validator.js)

The operation allowlist, official versions and source hashes are recorded in [EBAY_API_CONTRACT.json](EBAY_API_CONTRACT.json). No third-party SDK/dependency or proprietary specification is copied into the application.
