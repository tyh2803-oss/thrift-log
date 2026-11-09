# Thrift Log

A private reselling workspace built with Next.js App Router, TypeScript, Tailwind, shadcn-style Radix components, Lucide, Recharts, and Supabase/PostgreSQL.

**Working core application, with a separate fictional demo.** Live marketplace synchronization and production Supabase validation are still outstanding. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the exact implementation status and [the original product specification](docs/PRODUCT_SPEC.md) for the long-term scope.

## Run locally

Requires Node.js 22 or newer (developed with Node 24.22.1 and npm 11.9.0).

```bash
cd /workspace/thrift-log
npm ci --cache /workspace/.cache/npm
npm run dev
```

With no Supabase variables configured, the five-section application opens in **demo mode**. Its clearly labeled fictional data lives in this browser's local storage. Changes persist across reloads and never enter a private database. Settings can reset the demo. `/demo` always opens the separate demo, even after Supabase is configured.

The demo supports adding/editing inventory and photos, listings, manual multi-item sales, refunds/returns, CSV imports, expenses, trips, saved locations, visits, show lineups/checklists, time tracking, reports, search, and exports. Core views also work with an empty workspace.

## Connect your private workspace

The owner will use authenticated local Codex to apply and verify the saved migrations. Follow [the local Supabase handoff](docs/LOCAL_SUPABASE_HANDOFF.md), including identity/history inspection before DDL. Cloud feature development continues independently.

The owner has requested connection to project `gvwgasebholdawlakwdf` using a Supabase MCP URL. This cloud conversation does not expose Supabase MCP tools, `codex mcp list` reports no configured servers, and direct project/MCP requests are blocked by the running egress proxy. No hosted migration has been applied or hosted account verified.

The project URL is saved locally in ignored `.env.local` and proposed in the environment draft. App keys and owner email are still absent. MCP OAuth authorization and the application's runtime configuration are separate; connecting MCP does not automatically inject application keys. Partial configuration opens setup/sign-in instead of silently displaying fictional private data. `/demo` remains available separately.

1. Open the existing Thrift Log Supabase project (`gvwgasebholdawlakwdf`). In Authentication settings, **disable public signups**.
2. Inspect the target project and its migration history first. For a new project, apply `supabase/migrations/202611090001_initial.sql`, then `supabase/migrations/202611090002_auth_storage_hardening.sql` and `supabase/migrations/202611090003_financial_ledger_shipments.sql`, followed by `supabase/migrations/20261109203443_inventory_pipeline_fulfillment.sql`, in order through Supabase migrations or its SQL editor. Together they create owner-scoped tables, RLS, server-only transactional RPCs, audit history, private photo storage, owner-scoped Storage reads, and a server-only readiness verification RPC. The migration is for a new project; do not rerun it on an already initialized database. Future schema changes should be separate migrations.
3. Confirm your owner email/password account exists in Supabase Authentication; create it only if missing. Use the Supabase dashboard to manage or reset the password.
4. Preserve the existing `.env.local` (create it from `.env.example` only if absent), then set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OWNER_EMAIL`. Use the project's public/anon API key and server service-role key from Supabase's settings. Keep the server key secret. Never use a `NEXT_PUBLIC_` prefix for it.
5. Restart Next.js. The application now requires sign-in and opens an **empty private workspace**, not demo records. There is no demo-to-private automatic migration.
6. Run `npm run supabase:verify`. This read-only command loads `.env.local`, reports configuration names/status only, checks the schema/RLS/RPC grants and private bucket, and confirms the owner account exists. The app requires schema version 4 so an older server cannot discard ledger or item-fulfillment data. It never prints keys or user records. Then verify sign-in, create an item with photos, cross-list it, record a sale, reload, then sign out. Verify a signed-out browser cannot read `/api/workspace` or `/api/photos`. These hosted checks have not been executed yet.

The cloud environment's restricted network policy must allow your exact Supabase project hostname (usually `<project-ref>.supabase.co`). Configure credentials securely in environment/hosting settings, not chat or source code. The backend only sends Supabase credentials to that configured project. No marketplace credentials are required for the implemented manual/CSV workflows.

## Everyday workflows

- **Home:** current Inventory Pipeline with Cost / Sale Value / Profit and clickable stage filters, plus date-filtered revenue, operating profit, time, earnings/hour, trends, recent sales, marketplace breakdown, next show, and monthly goal.
- **Inventory:** table/grid, search, status filtering, aging, quick cost editing, bulk ready-to-list, duplicate item, photos, and linked marketplace listings. A physical item is counted once regardless of listings.
- **Sales:** multi-item orders, discounts, buyer shipping, direct costs, giveaways, tips, dated refunds/fee adjustments/reversals, partial physical returns, grouped packages, and actual allocated payout receipts. **Shows & events** holds Whatnot lineups, starting bids, preparation, presented items, event expenses, and separate labor/live-hour earnings.
- **Activity:** Buying/Listing/Selling timers, pause/resume/end, manual time, session editing/removal, trips, saved locations, check-ins, optional foreground nearby suggestions.
- **Insights:** P&L, inventory valuation, expenses, financial CSV, and marketplace/brand/category/source breakdowns.
- **Settings:** reporting timezone, USD currency, profit goal, theme, dashboard widget visibility/order, connections status, and demo reset. On mobile, use the avatar in the top bar.

`⌘K` / `Ctrl+K` focuses search. Quick add exposes the common actions from any view. The notification center links to delisting, fulfillment, missing costs, and stale listings.

## Imports and exports

Use the CSV templates in the import dialog. Pick Inventory, Sales, Listings, or Expenses; preview the file and map columns before saving. Validation errors prevent the entire batch from committing. Maximum file size is 3 MB, 5,000 input rows, and 999 new records per batch.

- Inventory requires a unique SKU, title, and explicit purchase cost (`0` is allowed for free inventory).
- Sales require stable `order_id`, exact SKU, and final per-item `price`. Marketplace defaults to Whatnot when unmapped. Repeated marketplace/order IDs group multiple physical items into one order. Each fee/shipping/discount/refund column is **per row**, not a repeated order total. Split shared totals first with an exact-cent allocation.
- The same marketplace/order ID is skipped on a later overlapping report. A changed report does **not** silently overwrite an earlier import: edit the existing order for corrections. Missing/ambiguous SKUs require explicit inventory mapping; no fuzzy title matching or invented cost basis.
- Listings require stable marketplace/listing IDs and a known SKU. Expenses require a stable UUID `expense_id`.
- Dates should be ISO 8601 with an explicit offset; date-only strings are interpreted as UTC. Monetary import amounts are decimal dollars with up to two decimal places. Internally they become integer cents.
- Original CSV content, column mapping, record IDs, filename, and import time are retained in private `imports` storage (or separate demo storage) for audit. They are not sent to a marketplace.
- Official Whatnot show/weekly/ledger formats have not been verified. Mapped import is operational; automatic official-report detection and ledger-specific reconciliation remain pending.

Exports are on the relevant section. Financial and order-level amounts are not a bank ledger. See [calculation definitions](docs/CALCULATIONS.md) and [integration limitations](docs/INTEGRATIONS.md).

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Pipeline validation passes 125 unit/database tests, 34 desktop/mobile Chromium browser tests, type checking, lint and production build. Hosted schema-4 readiness, rollback-only partial fulfillment and the real hosted assistant regression also pass. See PROJECT_STATUS.md for the exact working-checkout results, inherited Auth changes and WebKit/physical-device verification limits.

Unit tests cover money, allocation, refunds/cancellations, giveaways, tips, inventory integrity, imports, timers, and DST boundaries. Database integration tests run the migration and RPCs in PGlite (PostgreSQL compiled to WASM), with local Supabase auth/storage schema fixtures; they test RLS, direct-write denial, duplicate-sale rollback, and revision conflicts. They do not emulate Supabase Auth or Storage services.

Playwright tests use desktop and iPhone-sized Chromium. The default Chromium executable is `/usr/bin/chromium`. Elsewhere install Playwright Chromium (`npx playwright install chromium`) and set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable, or adjust `playwright.config.ts`. Tests run a dedicated production demo server after a build, explicitly clear app credential variables for that child process, and isolate browser storage. They never reuse a server that might be connected to real records. Set `PLAYWRIGHT_PORT` to an unused port when another app is already running. Stop a manually started production server before rebuilding; don't serve stale chunks from an earlier build.

## PWA and privacy

Manifest, PNG/iOS icons, standalone metadata, service worker, and a public offline fallback are included. On iPhone Safari, deploy over HTTPS and choose Share → Add to Home Screen. Actual iPhone installation remains unverified.

The service worker caches only explicit public assets and the offline shell. It never caches private pages, API responses, authentication, inventory, or photos. An open demo can save edits locally while disconnected; private edits require a connection and are not silently queued/replayed. Saved timers use timestamps, so locking or closing the browser does not stop elapsed time. Reloading offline shows the offline shell until connectivity returns. Text-field drafts are tab-scoped in session storage; recheck photo/item selections after recovery. Sign-out clears these drafts. No background geofencing or continuous background timer process is claimed.

## Deploy

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Do not use a deployment for real business data until hosted authentication/storage tests pass.

## AI assistant and screenshot imports

Open **Assistant** from the floating button or **Quick add → AI assistant**. Upload several completed-sale or active-listing screenshots, review inventory matches and profit, make corrections, then choose **Approve All Ready**. New inventory needs a known purchase cost and acquisition date. Missing amounts stay unknown; no business records are created before approval. Imported records appear in the existing Inventory/Listings, Sales and financial views.

Configure optional server-only `OPENAI_API_KEY`, `OPENAI_SCREENSHOT_MODEL` and `ASSISTANT_BATCH_LIMIT` from `.env.example`, then restart. Never prefix the key with `NEXT_PUBLIC_`. Without a key, manual/CSV workflows keep working and the assistant explains setup. `/demo` does not invoke private AI analysis.

See [assistant usage, privacy, architecture and verification](docs/ASSISTANT.md) and [current test/checkpoint results](PROJECT_STATUS.md). OpenAI Responses/vision requests use strict structured extraction and `store: false`; the existing command and financial layers control calculations and approved writes. Source screenshots are preserved in private Storage when available at approval. Live OpenAI vision has been verified with rendered test receipt images and in-memory inventory; genuine marketplace screenshot/real-inventory acceptance remains pending.

## Inventory Pipeline

Home includes a current **Unlisted → For Sale → Sold → Shipped** snapshot with one **Cost | Sale Value | Profit** toggle. Cross-listed pieces count once; estimates and incomplete/provisional amounts are labeled. Click stages to filter the existing Inventory/Sales views. Configure estimated selling expenses or hide the widget in Settings; manage partial shipments and handovers in Sales. See [stage rules, financial definitions and fulfillment limits](docs/PIPELINE.md).
