# Thrift Log

**Sale history imports:** [CSV and PDF guide](docs/SALE_HISTORY_IMPORTS.md). Sales CSVs require only item name, actual price, sale date and seller fees; select the marketplace and optionally include purchase cost. Native Depop bundles and assistant PDF/CSV review use the existing atomic approval flow. Unknown costs remain visibly incomplete, distinct from confirmed zero.

A private reselling workspace built with Next.js App Router, TypeScript, Tailwind, shadcn-style Radix components, Lucide, Recharts, and Supabase/PostgreSQL.

The [visual system](docs/VISUAL_SYSTEM.md) uses functional financial/status colors and accessible light/dark controls. The floating timer widget is removed; timers are started through Activity or Quick add and managed inline in Activity.

**Inventory stages:** compact five-stage filtering and list/grid bulk moves are documented in [the pipeline guide](docs/PIPELINE.md). Missing optional selling-expense estimates no longer block potential gross profit; known costs and asking prices are still required. Sale reversals retain dated history and require confirmation. No new migration is added.

**Existing invited testers:** the owner can use **Settings → Beta testers → Set up tester account** to privately share a one-use link. Friends choose their own password on the existing account, without SMTP or Terminal. See [tester account setup](docs/TESTER_ACCOUNT_SETUP.md). No new database migration or Auth setting change is required.

**Preauthorized registration:** [BETA_REGISTRATION.md](docs/BETA_REGISTRATION.md) adds Create Account for owner-approved tester emails without SMTP. Registration defaults to disabled; schema 7 and an explicit server setting are required. Public Supabase signup and global Auth settings stay unchanged. The guide explains email-ownership/recovery tradeoffs and optional confirmation mode.

**Invite-only beta rollout:** [BETA_ACCESS.md](docs/BETA_ACCESS.md) contains the current deployment steps for the existing Supabase and Vercel projects. This branch adds owner-managed tester access, separate private workspaces and revocation. It requires schema 6 and authorization of the existing owner before deployment; the older setup notes below describe the previous schema-4 checkpoint. Production SQL and merging main require explicit approval. No production migrations have been applied as part of this change.

**Working core application, with a separate fictional demo.** Hosted Supabase configuration, real Auth sessions, inventory persistence and private photo upload/download are verified. Owner password entry, remaining financial UI checks and deployment are documented in [PROJECT_STATUS.md](PROJECT_STATUS.md). Live marketplace synchronization is outstanding. See [the original product specification](docs/PRODUCT_SPEC.md) for the long-term scope.

## Run locally

For continued development in the published Codex Cloud environment, select **`feat/codex-cloud-handoff`** and read [the Cloud handoff](docs/CLOUD_HANDOFF.md). Local credentials and TLS keys are deliberately excluded; configure Cloud secrets separately.

Requires Node.js 22 or newer (developed with Node 24.22.1 and npm 11.9.0).

```bash
cd /workspace/thrift-log
npm ci --cache /workspace/.cache/npm
npm run dev
```

With no Supabase variables configured, the five-section application opens in **demo mode**. Its clearly labeled fictional data lives in this browser's local storage. Changes persist across reloads and never enter a private database. Settings can reset the demo. `/demo` always opens the separate demo, even after Supabase is configured.

The demo supports adding/editing inventory and photos, listings, manual multi-item sales, refunds/returns, CSV imports, expenses, trips, saved locations, visits, show lineups/checklists, time tracking, reports, search, and exports. Core views also work with an empty workspace.

## Connect your private workspace

Authenticated local Codex confirmed project `gvwgasebholdawlakwdf`, inspected its empty schema/history, and applied the four saved migrations on November 9, 2026. Hosted RLS/RPC/private-bucket and public API security checks pass; public signup is disabled. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for exact migration versions, evidence, and pending checks. Follow [the local Supabase handoff](docs/LOCAL_SUPABASE_HANDOFF.md) for future work, inspecting identity/history before any DDL. **Do not replay already applied migrations.**

The verified project URL, active publishable key, server key and owner email are configured in ignored `.env.local` (mode `0600`); the confirmed owner account exists. The existing `NEXT_PUBLIC_SUPABASE_ANON_KEY` variable accepts the publishable key. `supabase:verify` and the opt-in hosted integration check pass. MCP OAuth and runtime configuration are separate. Partial configuration opens setup/sign-in instead of fictional private data; `/demo` remains separate.

1. Open the existing Thrift Log Supabase project (`gvwgasebholdawlakwdf`). In Authentication settings, **disable public signups**.
2. Inspect the target project and its migration history first. For a new project, apply `supabase/migrations/202611090001_initial.sql`, then `supabase/migrations/202611090002_auth_storage_hardening.sql` and `supabase/migrations/202611090003_financial_ledger_shipments.sql`, followed by `supabase/migrations/20261109203443_inventory_pipeline_fulfillment.sql`, in order through Supabase migrations or its SQL editor. Together they create owner-scoped tables, RLS, server-only transactional RPCs, audit history, private photo storage, owner-scoped Storage reads, and a server-only readiness verification RPC. The migration is for a new project; do not rerun it on an already initialized database. Future schema changes should be separate migrations.
3. Confirm your owner email/password account exists in Supabase Authentication; create it only if missing. Use the Supabase dashboard to manage or reset the password.
4. Preserve the existing `.env.local` (create it from `.env.example` only if absent), then set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OWNER_EMAIL`. Use the project's public/anon API key and server service-role key from Supabase's settings. Keep the server key secret. Never use a `NEXT_PUBLIC_` prefix for it.
5. Restart Next.js. The application now requires sign-in and opens an **empty private workspace**, not demo records. There is no demo-to-private automatic migration.
6. Run `npm run supabase:verify`. This read-only command loads `.env.local`, reports configuration names/status only, checks the schema/RLS/RPC grants and private bucket, and confirms the owner account exists. The app requires schema version 4 so an older server cannot discard ledger or item-fulfillment data. It never prints keys or user records. The opt-in `npm run supabase:test-hosted` additionally tests real Auth sessions, inventory saves/reloads and private photos against a separately running loopback server on port 3100, cleaning up its temporary resources. Both commands now pass. Owner password entry and the remaining hosted financial UI checks are listed in PROJECT_STATUS.md.

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

Use the CSV templates in the import dialog. Pick Inventory, Sales, Listings, or Expenses; preview and map columns before saving. The standalone importer accepts files under 3 MB. Sales use a maximum of 300 physical item rows; the other import types retain their 5,000-row input and 999-new-record limits.

- Inventory requires a unique SKU, title, and explicit purchase cost (`0` is allowed for free inventory).
- Sales require only item name, actual price, sale date and seller fees. Purchase cost, order ID, SKU and other amounts are optional. Select the marketplace or use its column. The downloaded Sales template contains the four core columns plus optional purchase cost.
- Native Depop exports preserve verified bundles and count shared seller charges once. Generic repeated marketplace/order IDs group physical pieces; financial columns are per row, so allocate any shared totals before importing. Existing optional packaging and show-ID mappings remain supported. See [the sale history guide](docs/SALE_HISTORY_IMPORTS.md).
- Sales history includes every source row without similarity-based blocking or duplicate-confirmation checkboxes. Available exact identifiers can link unsold inventory; other rows create separate physical records. A new import can repeat prior source rows, while retrying the same approval stays idempotent. Unknown costs stay unknown, distinct from confirmed zero. Ready records can be approved together while unresolved drafts remain pending; each approval is atomic.
- Listings require stable marketplace/listing IDs and a known SKU. Expenses require a stable UUID `expense_id`.
- Sales dates use the workspace reporting timezone for date-only values; ambiguous slash dates require a format choice. Other legacy import types interpret date-only strings as UTC. Monetary values are decimal dollars with up to two decimal places, stored as integer cents.
- Sales retain safe extracted facts, source hashes and approval decisions in private receipts; buyer/contact columns and original binaries are not retained. Other CSV import types retain their original content and mappings. No import updates an external marketplace.
- Official Whatnot show/weekly/ledger formats have not been verified. Automatic official-report detection and ledger-specific reconciliation remain pending.

Exports are on the relevant section. Financial and order-level amounts are not a bank ledger. See [calculation definitions](docs/CALCULATIONS.md) and [integration limitations](docs/INTEGRATIONS.md).

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The Cloud handoff checkpoint passes 169 unit/database tests, 44 desktop/mobile Chromium browser tests, type checking, lint and production build. One opt-in live image benchmark is skipped without real inputs. Earlier hosted schema-4 readiness, rollback-only partial fulfillment and the normal hosted assistant regression also passed; one optional immutable-ledger test left a disabled synthetic fixture requiring admin cleanup. See PROJECT_STATUS.md and the Cloud handoff for exact evidence and limitations. Unit Auth/photo tests use explicit service doubles. Hosted checks are opt-in; no hosted writes or billable OpenAI calls were repeated for this handoff. Earlier WebKit sign-in verification passed, but later assistant click-automation attempts failed and physical iPhone acceptance remains pending. HTTPS destinations retain secure cookies.

Unit tests cover money, allocation, refunds/cancellations, giveaways, tips, inventory integrity, imports, timers, and DST boundaries. Database integration tests run the migration and RPCs in PGlite (PostgreSQL compiled to WASM), with local Supabase auth/storage schema fixtures; they test RLS, direct-write denial, duplicate-sale rollback, and revision conflicts. They do not emulate Supabase Auth or Storage services.

Playwright tests use desktop and iPhone-sized Chromium. The default Chromium executable is `/usr/bin/chromium`. Elsewhere install Playwright Chromium (`npx playwright install chromium`) and set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable, or adjust `playwright.config.ts`. Tests run a dedicated production demo server after a build, explicitly clear app credential variables for that child process, and isolate browser storage. They never reuse a server that might be connected to real records. Set `PLAYWRIGHT_PORT` to an unused port when another app is already running. Stop a manually started production server before rebuilding; don't serve stale chunks from an earlier build.

## PWA and privacy

Manifest, PNG/iOS icons, standalone metadata, service worker, and a public offline fallback are included. On iPhone Safari, deploy over HTTPS and choose Share → Add to Home Screen. Actual iPhone installation remains unverified.

The service worker caches only explicit public assets and the offline shell. It never caches private pages, API responses, authentication, inventory, or photos. An open demo can save edits locally while disconnected; private edits require a connection and are not silently queued/replayed. Saved timers use timestamps, so locking or closing the browser does not stop elapsed time. Reloading offline shows the offline shell until connectivity returns. Text-field drafts are tab-scoped in session storage; recheck photo/item selections after recovery. Sign-out clears these drafts. No background geofencing or continuous background timer process is claimed.

## Deploy

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Do not use a deployment for real business data until hosted authentication/storage tests pass.

## AI assistant and screenshot imports

Open **Assistant** from the floating button or **Quick add → AI assistant**. Active listings appear as compact, collapsed cards with cropped thumbnails, title, marketplace, asking price, purchase cost and estimated gross profit. For a clear new listing, enter its cost and choose **Approve All**. Exact inventory matches link automatically; a plausible conflicting item requires choosing the match or **Create different item**. Expand the chevron to correct extracted details, match saved inventory or link cross-listings to another pending physical draft. Trash removes only that proposal, and **Clear All** confirms discarding pending drafts.

**Batch Cost** supports the same cost per new item, splitting a total in exact cents, or individual costs. Optional selection applies only within that bulk operation. Allocations count each physical draft once, update all its cross-listings, show which drafts were included and allow individual overrides. Recorded acquisition costs remain protected behind explicit correction. New acquisition dates default to the workspace's current date as a labeled assumption accepted by final approval; use the batch date selector for earlier purchases. Assumptions remain identified in inventory notes and the import audit. Optional vintage age, original listing dates and descriptions do not require routine confirmation.

The footer stays visible outside the scrolling cards, shows ready records and asking value (one conservative price per physical item), and approves all valid records in one Supabase transaction. Unresolved drafts survive partial approval and failed saves. Confirmed sales retain their existing financial and lifecycle review, and saved sales offer **Mark Shipped / Mark Fulfilled**.

Configure optional server-only `OPENAI_API_KEY`, `OPENAI_SCREENSHOT_MODEL` and `ASSISTANT_BATCH_LIMIT` from `.env.example`, then restart. Never prefix the key with `NEXT_PUBLIC_`. Without a key, manual/CSV workflows keep working and the assistant explains setup. `/demo` does not invoke private AI analysis.

See [assistant usage, privacy, architecture and verification](docs/ASSISTANT.md) and [current test/checkpoint results](PROJECT_STATUS.md). Clothing review now includes descriptive garment attributes, visual/text evidence, conservative vintage assessment, per-screenshot marketplace confidence and private card crops. Use **Scan Listing for This Item** in an existing inventory editor to preserve the known physical item. OpenAI Responses/vision requests use strict structured extraction and `store: false`; the existing command and financial layers control calculations and approved writes. Source screenshots are preserved in private Storage when available at approval. Live OpenAI vision has been verified with rendered test receipt images and in-memory inventory; genuine marketplace screenshot/real-inventory acceptance remains pending.

## Inventory Pipeline

Home includes a current **Unlisted → For Sale → Sold → Shipped** snapshot with one **Cost | Sale Value | Profit** toggle. Cross-listed pieces count once; estimates and incomplete/provisional amounts are labeled. Click stages to filter the existing Inventory/Sales views. Configure estimated selling expenses or hide the widget in Settings; manage partial shipments and handovers in Sales. See [stage rules, financial definitions and fulfillment limits](docs/PIPELINE.md).

## Sign-in troubleshooting

Refresh an older login tab after a local rebuild. Sign-in now supports a normal POST before JavaScript loads, checks the saved session before opening Home, and shows cookie/connectivity/timeout errors inline. It does not require changing your existing password. Use the address of the running local app; local fixes do not automatically update a deployed site. Optional real Auth regression: `HOSTED_CHROMIUM_EXECUTABLE=/path/to/chrome node --env-file=.env.local --experimental-strip-types scripts/verify-signin.mjs` (disposable account, no business writes).

## iPhone testing over private Wi-Fi

Use **https://192.168.18.125:3000/login** after installing and trusting the exported local CA on your iPhone. HTTP LAN authentication alone cannot enable the browser cryptography required by inventory, timers and screenshot uploads. Run `npm run dev:https` to restart the configured local HTTPS server. See [certificate installation, API audit and test results](docs/LOCAL_HTTPS.md). This setup does not push or deploy the repository, expose a public tunnel, or change production HTTPS security.
