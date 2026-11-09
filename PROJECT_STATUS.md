# Thrift Log project status

Updated November 9, 2026 (financial ledger and local Supabase handoff). This is a functional initial implementation of the core manual/CSV workflows. It is **not the complete long-term specification**, and no marketplace connection or hosted Supabase deployment is verified.

## Implemented

- Next.js App Router / TypeScript / Tailwind, Radix/shadcn-style button/dialog primitives, Lucide, Recharts.
- Five primary destinations, compact desktop sidebar, mobile bottom navigation, global quick add/search, secondary settings, light/dark themes, configurable dashboard widget order/visibility.
- Clearly separated fictional browser-local demo, repeatable reset, empty-workspace support, private-workspace mode when Supabase is configured.
- Supabase password sign-in/sign-out server routes and HttpOnly cookies, required owner-email restriction, server-side session refresh through Next.js proxy, dynamic sign-in/setup state, and no public signup UI. Hosted service validation is pending.
- Relational PostgreSQL migration, owner RLS, server-only writes, optimistic revision locking, transactional batches, physical-sale uniqueness, original-order and order-line audit, private photo bucket and authenticated upload/read routes. Validated with PostgreSQL/PGlite, not hosted Supabase.
- Inventory CRUD, multiple photo upload/removal and a navigable photo gallery, SKU uniqueness, table/grid, search/status/sort, aging, quick purchase-cost edit, batch identical-item purchase split, duplicate item, bulk ready-to-list.
- Physical items linked to multiple marketplace listings, direct links, price/status edits, automatic internal sold status, actionable manual delisting flags.
- Manual multi-item orders, cost snapshots, exact-cent cost allocation, discounts, buyer shipping, direct costs, legacy cumulative corrections, giveaways/tips, and cancellations.
- Dated immutable Refund, Fee/Revenue/Direct cost adjustment, Return and Reversal events; partial physical returns and resale; original-period financial preservation; order/line basis locks once posted.
- Actual dated payout receipts and exact order allocations, partial receipts, duplicate/reference/overpayment checks, and payout reversals. Receipts change cash/outstanding proceeds without adding profit.
- Grouped marketplace packages, tracking/status updates across linked orders, explicit one-time exact-cent label allocation, duplicate shipping protection, and consistent order fulfillment.
- Dated P&L and ledger/CSV exports with separate profit/cash columns; sales export has one row per order to prevent duplicated totals. Marketplace breakdowns include tips and dated corrections; average merchandise price excludes tips/shipping.
- Whatnot/in-person planner: dates, lineup reservations, starting bids, presented flags, checklist, unsold-stock release, print view, linked orders/expenses/labor, profit breakdown, separate livestream and labor hourly earnings.
- Trips, saved locations, spending-versus-assigned-cost view, linked inventory and expenses, realized-so-far trip earnings, start/end visits, optional foreground nearby suggestions.
- Buying/Listing/Selling timer with start/pause/resume/end and timestamp persistence, manual sessions, editing/removal, overlap-safe totals, project associations.
- Dashboard/date presets/custom ranges, timezone-aware DST boundaries, P&L, expenses, current inventory cost/asking value, period earnings/hour, marketplace/brand/category/source item-profit breakdowns.
- Generic mapped CSV inventory/sales/listing/expense import, row preview, exact SKU matching, duplicate detection across overlapping order reports, atomic validation, original file/mapping audit. Section CSV exports with spreadsheet formula protection.
- Installable PWA metadata, PNG/SVG/iOS icons, standalone manifest, public offline fallback, sensitive-route cache exclusion. Tab-scoped text drafts; private offline mutation is intentionally not queued.
- README, environment template, database/deployment/calculation/integration guides, original specification preserved.

## Verification

- Passed: TypeScript check, ESLint, production build, 54 unit/database tests, and all 18 Playwright tests (9 desktop + 9 iPhone-sized Chromium).
- Repeatable frozen-lockfile dependency installation (`npm ci`) was exercised, followed by the setup script and a production startup.
- Lint uses ESLint 10.14.0. Some Next.js lint plugins still declare ESLint 9 peer ranges; npm reports peer warnings, while the executed lint checks pass.
- Twelve new auth/config/photo tests use service doubles: wrong-owner rejection, expired sessions, cookie refresh/persistence, CSRF, unavailable configuration, private signed URLs, upload paths, and MIME signatures. PostgreSQL tests cover all three migrations, service-role diagnostics, Storage owner policies, and isolation across all 12 business tables.
- No hosted Auth/Storage/API account has been tested, and no application deployment has been made.
- Browser tests use Chromium with desktop and iPhone-sized viewports; actual iOS Safari installation remains unverified.

## Hosted Supabase application delegated to local Codex

The owner explicitly confirmed that MCP is authenticated locally, not in this cloud task. Continue feature development here; do not keep asking for cloud MCP access or claim hosted execution.

- Existing target project: `gvwgasebholdawlakwdf`. Preserve it and inspect schema/migration history before applying missing files.
- Complete local handoff: `docs/LOCAL_SUPABASE_HANDOFF.md`.
- Saved migrations: initial schema, Auth/Storage hardening, and additive financial ledger/shipments (`202611090001`, `202611090002`, `202611090003`). All three execute in PostgreSQL/PGlite tests. None is confirmed applied remotely.
- `supabase/config.toml` provides local CLI configuration with signup disabled; syntax/defaults checked with Python TOML. Hosted Auth settings and CLI execution remain unverified.
- Existing owner-scoped RLS and private photo policies remain in migrations; all 18 business/ledger tables deny cross-account reads and client financial writes in tests. Server-only RPCs and the unexposed `thrift_log_private` schema preserve the trusted write path.
- Next.js authentication, session refresh, owner checks, database persistence, private-photo routes, and a read-only `npm run supabase:verify` command remain in source. Workspace loading checks schema version 3 and readiness flags before accepting financial changes.
- The project URL is preserved in ignored `.env.local`. Runtime key and owner-email requirements remain documented for secure local/hosting configuration. No credentials are invented or requested in chat.
- The environment draft retains known project/network requirements; saving it is not remote configuration application or publication. Explicit `/demo` remains separate from private records.

## Integration blockers

Whatnot/eBay official documentation requests returned HTTP 403. Required domains are saved in the environment draft; runtime access remains blocked. API clients cannot be correctly implemented/verified until official documentation, application/account approval, and credentials are available. All adapters truthfully report manual/CSV or awaiting-verification states. No tokens, webhooks, external delisting, or invented endpoints are in use.

## Remaining product work

- Official Whatnot/eBay API clients, secure token lifecycle/OAuth where verified, sync status/logs/retries, supported webhooks, automatic matching/imports, authorized external updates.
- Official report-type detection/mappings, ledger-specific adjustments, unmatched-import staging, correction reconciliation across mixed report formats.
- Bank import/clawback reconciliation, partial payout debits, package cancellation/splitting, historical inventory valuation, and jurisdiction-specific tax preparation. Dated ledger CSV is available; it is not a tax filing form.
- Full show comparison/history charts, audience metrics from real APIs, detailed brand sell-through/turnover/days-to-sale, precise cross-marketplace labor comparisons, goals beyond monthly profit.
- Receipts, advanced category/subcategory management, batch bulk updates beyond ready-to-list, draft photo/selection recovery, estimated-net-proceeds scenarios.
- General offline private-data synchronization, actual iOS device testing, larger-data pagination/incremental persistence, backup/restore UI, optional AI features.

## Next priorities

1. Owner applies/verifies missing hosted migrations and Auth/Storage settings from authenticated local Codex using the saved handoff. Cloud development does not depend on this.
2. Add import reconciliation staging and official report mappings once official documentation/sample reports can be verified; implement read-only Whatnot sync first when available.
3. Extend show comparisons, sourcing/brand sell-through and inventory history, then package/bank reconciliation and the remaining advanced workflows.
