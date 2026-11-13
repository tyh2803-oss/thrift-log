# CSV and PDF sale history

Sales CSV imports need only **item name, actual sale price, sale date, and seller fees**. Enter `0` explicitly for no seller fees. Order IDs, SKUs, purchase costs and other columns are optional. Existing optional packaging and show-ID mappings remain supported. Existing inventory names may be obtained from an exact SKU instead of another name column.

```csv
Item Name,Price,Date,Fees,Purchase Cost
Example jacket,25.00,2026-11-10,1.50,
Example boots,30.00,2026-11-11,2.00,0
```

The first purchase cost is **unknown**; the second is a **confirmed zero**. Neither is a request to infer a cost. Select **Import CSV → Sales**, upload the file, select its marketplace (or use a marketplace column), check the four mappings, then **Review sales → Approve All Ready**. Optional columns are collapsed separately. Ambiguous slash dates require choosing Month/day/year or Day/month/year; dates are never replaced with today. Dates without times use the workspace's reporting timezone. The app supports USD and does not convert currencies.

## The supplied Depop format

The U.S. Depop report is recognized from its actual headers. The supplied example has **44 item rows, 40 sales and one five-item bundle**; it has no usable SKUs or order IDs. Native parsing is deterministic and requires no AI call.

- `Description` supplies item names; `Item price` is merchandise value, not `Total` or payout.
- Depop fees, Depop Payments fees and boosting fees remain seller costs. Buyer Marketplace Fee and US Sales tax are excluded from seller revenue/costs.
- Bundles are verified using their reported item count, date/time and buyer grouping locally. Their shared processing/shipping values are counted once. Incomplete or ambiguous bundles are rejected rather than allocated by guesswork.
- The exact exported literal `="-"` and `N/A` are data placeholders, never executable formulas. On a bundle continuation they refer to the single header amount. The native boosting/refund “not applicable” markers are handled separately from unknown purchase costs.
- Optional shipping mappings are visible. Buyer shipping is excluded by default because a buyer charge does not prove seller receipt. Map it only after verifying it was paid to you; USPS Cost covers only reported labels, not shipping paid elsewhere. No tax or buyer platform charges are silently used as seller proceeds.
- Buyer/contact/address columns are not retained in drafts or approval receipts, and the native report is not sent to OpenAI. The uploaded example remains outside the repository; committed fixtures are synthetic.

Provide at most 300 item rows per CSV batch and at most 30 physical pieces per order. Reports are split into at most ten review source parts without splitting verified orders. Real refund/fee-credit rows need reconciliation against their original orders, not another completed sale. Payout receipts and fulfillment are not inferred from a sales report.

## Assistant files

### Personal spreadsheets and missing information

The assistant accepts informal CSV exports, including title/year rows before the table, blank columns, duplicate column headings, repeated headers, side-by-side totals, and comma/semicolon/tab delimiters. UTF-8 and BOM-marked UTF-16 text exports are supported. `Item`, `Purchased Price` and `Sold Price` are recognized without renaming columns. Explicitly labeled footer totals are excluded with a visible preparation note; side-summary columns never become item prices or acquisition costs. Original files are not changed.

Readable item rows are prepared even when dates, prices or fees are missing. Missing values remain unknown and block saving only where the existing sale workflow requires them. The review offers **Fill missing dates** and **Fill missing fees** for included drafts. The fee amount is **per sale**, not a batch total; enter zero only when there really were no seller fees. Known source values and saved records are not overwritten. Purchase costs stay optional, with explicit zero separate from unknown.

For example, attach a personal spreadsheet and say “These were sold on Depop yesterday.” Missing sale dates can use yesterday in the workspace reporting timezone, and the assistant labels that context-derived date for review. Source dates, marketplace fields and non-sale statuses take precedence. Conflicting or ambiguous context is left unresolved. A year heading alone does not establish a sale date. Non-sale rows require clarification or discarding; they are never silently posted as completed sales.

Known sale tables use exact parsing instead of requiring an AI round trip per item. Other layouts and readable PDFs still use the configured file-capable AI model. AI CSV responses now identify their source data rows: skipped, repeated or out-of-range references are rejected, and an item cannot be silently classified as an ignored summary. Identical sections retain their distinct source positions even when extraction uses a cached response. Up to three prevalidated analysis parts run concurrently; caches remain isolated by account, context, date and timezone. These changes do not provide unrestricted ChatGPT tools, execute spreadsheet formulas, or add support for arbitrary binary office formats.

**Add files** accepts JPEG/PNG/WebP images, PDF and CSV text exports. Paste, drop or select files. The assistant's existing screenshot extraction and image approval path remains separate and unchanged in meaning.

Recognized sales CSVs use the same native parser as Import CSV. Unfamiliar CSV headers and PDFs use the configured OpenAI Responses model and strict structured facts, then the same history review. No document instructions, formulas or links are executed. Recognized buyer/contact columns are removed before an unfamiliar CSV reaches AI. PDFs are sent inline to the configured provider only after Send, with `store:false`; they are not opened as active browser documents or uploaded to the photos bucket. Missing values stay nullable. Explicit pending/cancelled/refunded/shipping events cannot become completed sales simply because a price appears.

The PDF contract permits at most 30 transactions per source and requires a completeness declaration; incomplete/truncated responses and CSV row-count mismatches fail closed. Split larger PDFs. Existing upload bounds remain: 5 MB per prepared file, 16 MB application batch, up to ten analysis parts; the hosting platform may impose a smaller request limit. Password-protected, corrupt, invalid-encoding and oversized files receive actionable errors.

No new provider credential or Supabase setup is required. PDFs/unfamiliar CSVs need the existing server OpenAI key and a file-capable configured model (the existing default supports native PDF input). There is no model fallback or public analysis endpoint. Owner-isolated caches and the shared twenty-uncached-analysis-attempts/minute budget apply to images and documents. `/demo` cannot spend private AI credits; the standalone demo CSV importer remains browser-only.

Drafts are scoped to the signed-in user. Source type, file name, hashes, original/corrected facts and approval decisions remain in private receipts; original PDF/CSV binaries are not archived as inventory photos. Keep the original report if you need a document archive.

## Identity and accounting safeguards

Every source row is included. Similar titles, brands and sizes do not block imports or require confirmation checkboxes. An available exact identifier may reuse existing unsold inventory; repeated identifiers, already-sold items and unmatched rows get separate physical records. The optional inventory selector remains available. Extraction notes are informational; valid required values determine readiness.

A deliberate new import can add the same source rows again. Internal UUIDs and SKUs stay unique, while original source SKUs and order IDs remain in the receipt. When an external order ID is already in use, the new record leaves its unique database external ID empty instead of overwriting the original transaction. Existing posted sales and purchase costs remain untouched. Retrying the **same approval** stays idempotent, distinct from deliberately starting another import. Server-side replanning, live authorization, revision checks, existing atomic SQL transactions, tenant RLS and private photo protections remain in force. Invalid dates/amounts, unsupported currencies/events and genuine save/access failures still require correction; they cannot safely be suppressed.

A historical purchase date is not established by a sale/listing date. For new items whose acquisition date is absent, the sale date is an **explicitly labeled storage placeholder** with durable provenance. Review can supply the real date; inventory age, sourcing-duration calculations and dated inventory-acquisition totals exclude unknown placeholders. They are not claimed purchase history.

Omitted purchase costs remain explicitly unknown in durable receipts. Existing nonnullable integer-cent columns use their legacy zero placeholder, with per-item unknown/confirmed-zero proofs committed in the same transaction. Missing costs suppress profit, margin, ROI, hourly figures and misleading chart points; financial exports leave affected cost/profit fields blank. Revenue and recorded fees remain usable. Returned stock with an unknown acquisition cost also remains unknown. Existing records are not rewritten or reclassified.

**Historical cost basis stays immutable.** Editing an item's current purchase cost does not retroactively fill an already posted unknown sale cost. Enter known historical costs during review where available. A dedicated audited historical cost-backfill workflow is outside this change; missing historical costs continue to be labeled incomplete. No numeric zero should be treated as confirmed free inventory without its proof. New financial features must honor the completeness helpers, not display raw placeholder-derived profit as final.

Only valid reviewed records are approved together. Unresolved drafts remain pending, failed saves do not report success, and confirmed retries use durable receipts instead of making another sale. No production database, Auth setting or Storage policy was changed during implementation. No migration is added.

## Validation

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, `npx playwright test --config=playwright.history.config.ts`, `npm run test:registration-browser`, and `npm run test:tester-setup-browser` are the available checks. The authenticated browser harness permits business writes only in an explicitly opted-in loopback service double. Database tests execute the real saved SQL in local PostgreSQL/PGlite. Hosted Supabase writes and live paid PDF extraction are not part of these tests. Physical iPhone/Safari acceptance remains manual.
