# Thrift Log project status

**Latest assistant checkpoint (November 9, 2026):** screenshot sales/listing review and approved imports are implemented. Typecheck/lint/build, 110 unit/database tests, all 24 desktop/mobile browser tests and isolated real Supabase/WebKit approval checks pass. Live OpenAI vision now passes with rendered test images; genuine marketplace screenshot matching and actual iPhone acceptance remain pending. See the latest vision follow-up below and `docs/ASSISTANT.md`.


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

## AI assistant and screenshot imports — paused before implementation (November 9, 2026)

The requested implementation is restricted to **GPT-6.1 Sol only**. This session cannot verify its exact serving model, so no feature implementation has begun. This is an unverified model identity, not evidence of a detected model switch or exhausted allowance. Resume only with GPT-6.1 Sol explicitly selected and available.

### Saved continuation checkpoint

- Existing HEAD: `9b8ef90` (`Build Thrift Log reselling management application`). All six assistant milestones remain unstarted in this session; no assistant code has been inspected or verified yet.
- The checkout already contained uncommitted Auth/configuration/documentation/test changes and three untracked hosted/browser verification files. These were preserved without staging or committing unrelated work.
- A local recovery snapshot of the pre-task tracked diff, untracked nonignored files, Git status and HEAD is saved at `.git/checkpoints/before-ai-assistant-20261109T173401Z`. This lives inside `.git`, is not pushed, and excludes ignored credentials. Inspect it before any manual recovery; do not blindly apply it over later changes.
- This session read Git status, recent commits, this status file and `AGENTS.md`. No source code, dependencies, database, business records or credentials were modified. Only this continuation note was added after the local snapshot.
- No tests ran in this paused session. Earlier verification results above belong to the previous work and do not establish assistant functionality.

### Exact next steps when the required model is available

1. Read this file, inspect recent commits and all uncommitted changes, and preserve the existing Auth fixes. Confirm GPT-6.1 Sol is explicitly selected and available; do not infer verification from this note.
2. Inspect `README.md`, `docs/PRODUCT_SPEC.md`, `src/lib/model.ts`, `src/lib/commands.ts`, `src/lib/operational-commands.ts`, `src/lib/ledger.ts`, `src/lib/finance.ts`, `src/lib/use-workspace.tsx`, `src/components/importer.tsx`, existing migrations, navigation and shared UI. Read the relevant installed Next.js guides under `node_modules/next/dist/docs/` before writing code, as required by `AGENTS.md`.
3. Read applicable OpenAI, Supabase and Postgres skills before their respective implementation work; review current official OpenAI multimodal/Responses/structured-output documentation. Inspect existing test scripts and run the relevant baseline checks, keeping previously documented UI failures separate from new regressions. Do not replay hosted migrations with mismatched version identifiers.
4. Implement milestone 1 only first: global responsive chat, up to approximately ten image attachments with thumbnails/removal/drop/paste/mobile selection, server-only OpenAI configuration and Zod-validated structured extraction. Show an honest setup message without an API key and use deterministic extraction doubles for tests. Do not fabricate screenshot results.
5. Test and document milestone 1, then continue sequentially: sales extraction/matching/profit/duplicates; editable and conversational batch review with explicit approval and validated persistence; active-listing imports; existing-view dashboard metrics; final tests and documentation. Reuse existing financial and command logic, preserve unknown costs as unknown, and never insert business records during preparation. Record each tested checkpoint and exact remaining work.
6. Before declaring completion, run type checking, lint, unit/database tests, production build and appropriate desktop/mobile browser tests. Distinguish mocked extraction, real OpenAI verification and hosted Supabase verification explicitly. Do not push automatically.

The separate **Inventory → For Sale → Sold → Shipped** pipeline remains a future roadmap item and is outside this assistant implementation. Keep the assistant within existing Inventory/Listings navigation. The first priority remains screenshot sales import with reliable matching, existing financial calculations, corrections and one-click batch approval, followed by listing imports.

## Assistant implementation checkpoints — resumed November 9, 2026

The user explicitly requested continuation with GPT-6.1 Sol. The agent cannot independently inspect the serving model identity and has not claimed to verify it. No model switching or delegation was requested or performed. Work is on local branch `feat/ai-assistant-screenshots`; nothing has been pushed. The earlier pause note above is historical.

### Milestone 1 — foundation complete

- Added a global assistant button and Quick add entry, responsive desktop chat panel/mobile full-screen dialog, multiple screenshot attachments, compression, thumbnails/removal, paste/drop/photo-library file selection, messages and extracted-fact display. Closing the panel preserves its in-memory state.
- Added owner-authenticated, origin-checked, no-store `/api/assistant/extract` configuration and analysis routes. OpenAI uses server-only `OPENAI_API_KEY`, Responses API image input, strict JSON Schema derived from Zod, `store: false`, configurable model and bounded batch/image/request limits. Default application extraction model is `gpt-4.1-mini-2025-04-14`; this is separate from the implementation-session model restriction. There is no automatic model fallback.
- Unknown monetary amounts remain null; screenshot text cannot issue business commands. Owner-isolated bounded cache collapses repeat/in-flight images; sanitized provider errors preserve attachments for retry. Demo analysis requires private sign-in. No business writes or permanent image uploads occur during extraction.
- Read the requested domain/import/navigation/schema files and installed Next.js route/server-client guides. Reviewed official OpenAI vision/structured-output/model pages and Supabase changelog/Storage access documentation. Existing command/ledger logic will be reused, not replaced.
- Validation actually run: baseline 57 unit/database tests; after foundation, **68 unit/database tests pass**, typecheck passes, lint passes, production build passes; **2 new assistant Playwright tests pass** (desktop and iPhone-sized Chromium via local Chrome). These browser tests cover attachments, removal, close/reopen state, layout bounds and the demo/private boundary. No real OpenAI screenshot interpretation or new hosted Supabase write was tested.
- Existing uncommitted Auth fixes and hosted/browser scripts remain untouched and outside the assistant commits. Pre-resume documentation copies are in `.git/checkpoints/assistant-resume/`; the earlier full recovery snapshot remains intact. Documentation/environment additions are saved but left unstaged to avoid sweeping pre-existing changes into assistant commits.

Next: milestone 2 — reusable exact/ambiguous inventory matching, automatic stored cost retrieval, duplicate detection and profit previews through existing money/ledger functions. Then milestone 3 editing/corrections/approval and persistence, milestone 4 listing commits, milestone 5 existing-view metrics, and milestone 6 comprehensive verification. No approval functionality exists at this foundation checkpoint; extracted facts are not yet sales records.

### Milestone 2 — sales matching and financial previews complete

- Added reusable exact listing-ID/product-ID/SKU/URL matching, ranked approximate candidates without automatic uncertain selection, typed pending batches and read-only review cards.
- Preview retrieves stored cost, requires explicit confirmation of legacy zero costs, and uses `orderTotals`/`lineProfits` plus command-layer validation. Missing fees/shipping stay unresolved and estimates are labeled provisional. Offers/pending/refunded screenshots cannot become completed sales automatically. Date-only imports use the workspace timezone.
- Existing marketplace/order IDs (including CSV/manual orders), sold physical inventory, repeated image hashes and included duplicate order rows are checked. Multi-item order totals are applied once with the existing exact-cent allocation. Cross-listing behavior is verified through the existing commands.
- Validation actually run: **83 unit/database tests pass**, typecheck and lint pass. Added matching, ambiguity, no-match, cost/fee/shipping/discount, multi-item allocation, duplicate, completion-status and timezone tests. No hosted writes or real OpenAI calls were performed.
- Next: milestone 3 — searchable inventory selection, inline editing, conversational corrections, safe draft recovery, batch inclusion/exclusion and authenticated approval with current-state revalidation/transactional persistence. Listing creation remains deliberately blocked until milestone 4.

### Milestone 3 — editing and approved sales persistence complete

- Added inline sale/marketplace/date/currency/status/amount editing, searchable inventory selection with candidate photos and listing/cost details, zero-cost confirmation, warnings review, batch inclusion/exclusion, and Approve All Ready. Unsupported or ambiguous text edits ask for clarification; bounded deterministic corrections support price, shipping, fees, discount, marketplace and explicit unique inventory names without re-analyzing images or creating transactions.
- Pending extracted/corrected metadata is validated and stored in owner/demo-scoped tab session storage, cleared by the existing sign-out draft cleanup. Image bytes stay only in in-memory object URLs and are not put in JSON/session storage. Restored drafts retain their source hashes and extracted fields; image previews require reattachment after reload.
- Added authenticated/origin-checked `/api/assistant/approve`: reloads the workspace, validates included row IDs/revision/current inventory/duplicates, generates only typed commands, commits using existing transactional `commit_workspace`, and reports success only on a valid database confirmation. Stable per-row import receipts make lost-response retries idempotent; failed/conflicting approvals preserve pending drafts.
- Provenance uses existing private `imports` storage: `mapping.format=assistant-v1`, source filename/hash, original extraction, corrected facts, matching decisions, batch ID, approved record IDs and approval timestamp. The legacy `rawCsv` column holds bounded JSON metadata for assistant imports; it contains no image bytes. No database schema change or hosted migration was needed. The existing workspace loader was extracted to a shared server-only module; prior Auth fixes were preserved.
- Validation actually run: **94 unit/database tests pass**, typecheck passes, production build passes; lint passed with one unused-import warning that has since been removed. **4 assistant browser tests pass**, desktop and iPhone-sized Chromium: attachments, no-write preparation, text correction/recalculation, draft reload, revision-conflict recovery, batch approval and persisted single-sale result. PGlite round-trip verifies approved sales, provenance, profit, cross-listing alerts and revision locking. Server approval tests use explicit service doubles. No real OpenAI call or new hosted Supabase financial write was performed.
- Next: milestone 4 — existing-listing updates and new inventory/listing creation, stable listing duplicate handling and active-listing batch approvals. New inventory and listing approval remain blocked at this checkpoint. Then existing-view metrics and full validation/documentation.

### Milestone 4 — active listings and new inventory complete

- Active-listing drafts now add or update the existing marketplace listing while preserving original price and known listing date. Same-price/identifier duplicates, conflicting IDs, ambiguous existing listings and wrong physical-item relationships stay pending. Cross-marketplace listings use the same physical item.
- Review supports creating a new physical item for either listings or missing-inventory sales. Extracted attributes prefill the item; explicit SKU, known cost (including an intentionally entered zero), acquisition date, title and new-physical-item confirmation are required. Exact existing identifiers prevent duplicate creation. New item plus listing/sale commit atomically through existing commands.
- New listings require an explicit listing date when none exists; missing dates/attributes are never invented. Existing listings retain their stored date when a screenshot omits it. Review also allows an explicit current purchase-cost correction; it is committed only on approval and previous sale snapshots remain unchanged.
- Validation actually run: typecheck and lint pass; **102 unit/database tests pass**, including existing-listing updates, additional marketplaces without inventory duplication, new-item creation, missing costs/dates, duplicate/conflicting identifiers, exact-match duplicate prevention, cost correction and missing-inventory sales. No hosted changes or real OpenAI calls were made.
- Next: milestone 5 — marketplace filtering and clear existing Inventory/Listings summary metrics, then milestone 6 final robustness, privacy/provenance, browser and regression verification, and documentation.

### Milestone 5 — existing dashboard integration complete

- Added marketplace filtering within the existing Inventory/Listings view, with physical-item counts, active-listing counts, acquisition-cost valuation, combined active asking prices, cross-listed physical items, unlisted stock, sold items, delisting work and marketplace active counts.
- Acquisition cost counts unsold physical items once; aggregate listing asking value is labeled separately from inventory cost and realized profit. No new top-level navigation destination or future inventory pipeline was added.
- Validation actually run: **104 unit/database tests pass**, typecheck and lint pass. New metric tests verify cross-listing without double-counting, marketplace filters, sold inventory/delisting and empty/unlisted cases.
- Checked only the presence of `OPENAI_API_KEY` without printing any credentials: it is not configured. Real OpenAI screenshot interpretation remains unverified; extraction tests use deterministic service doubles.
- Next: milestone 6 — harden image validation/private screenshot provenance, add complete listing/new-item mobile browser scenarios, run full checks and document exact remaining verification limits.

### Milestone 6 — automated and hosted implementation verification complete; real-vision acceptance pending

Final implementation is on `feat/ai-assistant-screenshots`. Completed checkpoint commits before the final verification/documentation commit:

| Checkpoint | Commit |
| --- | --- |
| Assistant foundation and structured extraction | `4e4483a` |
| Sales matching and financial previews | `1287b4c` |
| Editing, corrections and approved persistence | `87c4b4c` |
| Active listings and new inventory | `669c86c` |
| Existing-view marketplace metrics | `e547110` |

Final verification actually performed:

- **110 unit/database tests pass** (9 files), including screenshot/API failures, invalid/corrupt images, cache/rate controls, ambiguous/exact inventory matches, missing costs/fees/shipping, buyer/seller amounts, discounts, multi-item exact-cent allocation, foreign currency, edits/corrections, batch inclusion/exclusion, authenticated approval, revision conflicts, failed confirmation, durable retries, private source ownership/hashes, listing/new-item duplication, metric valuation and dated return/resale cost preservation.
- Type checking **passes**, ESLint **passes without warnings**, production build **passes**, and `git diff --check` **passes**. Sharp `0.35.5` was promoted from Next.js's existing optional dependency to a pinned direct dependency for actual server-side image decoding; dependency versions were not broadly upgraded. Installation used `--ignore-scripts`; existing ESLint peer warnings and npm's moderate audit findings were not addressed with unrelated upgrades.
- **All 24 Playwright browser tests pass**, desktop and iPhone-sized Chromium using local Chrome. This includes all six assistant cases plus the existing inventory/CSV/time/ledger/refund/package/payout/PWA regressions. After the final screenshot-capture adjustment, all six assistant cases passed again. Fictional desktop/mobile assistant screenshots were visually inspected from ignored `test-results/assistant-review-*.png` (animations disabled for accurate capture).
- The first complete browser run reproduced the same three previously recorded failures (21/24 passed). The cross-listing test navigated before awaiting its listing save; it now waits for dialog completion. The mobile order adjustment button overflowed its table cell; order actions now stack within the cell. Subsequent complete runs pass 24/24. These changes do not alter financial formulas or transaction behavior.
- `npm run supabase:verify` **passes** read-only hosted readiness/RLS/private Storage/owner/workspace checks. No migration was applied, replayed or changed.
- The new opt-in `scripts/verify-assistant-hosted.mjs` **passes** against real Supabase with an isolated production process (port 3152), disposable owner account and mobile-sized **WebKit** browser. It verifies actual password sign-in/cookies, no business writes during prepare, a listing update plus new inventory/listing in one approval, acquisition valuation counting each item once, a completed sale with stored cost and a $26 profit preview, sold inventory and cross-listing flags, lost-response receipt replay, repeated screenshot rejection, private source screenshot references/downloads and anonymous download denial. All synthetic records, images, sessions and the disposable account were cleaned up. The configured owner's normal password and business records were not accessed or modified.
- Hosted extraction is **explicitly mocked at the browser FormData boundary** with deterministic facts and tiny generated image fixtures. Auth, approved business commands, database persistence and Storage are real; **OpenAI interpretation is not verified**. `OPENAI_API_KEY` is absent. Do not present these fixtures as real marketplace image analysis.

Final hardening and recovery behavior:

- The assistant waits for the initial workspace load before analysis, preventing an empty/stale initial inventory match. This was found during hosted verification and corrected.
- Available original screenshots are uploaded to the existing private photo bucket only after approval. Their owner paths and SHA-256 hashes are verified before the financial commit. References/metadata are audited without embedding image bytes in JSON. A successful image upload is remembered across failed approvals to prevent a retry upload. Reattaching the original after draft reload makes its bytes available for preservation again.
- Existing zero costs require confirmation/correction, missing amounts remain null, non-USD amounts require correction and explicit currency confirmation, unknown new-item/listing dates remain unresolved, and positive refund screenshots route to original-order reconciliation. Existing financial commands and dated ledger rules remain authoritative.
- During hosted harness development, early runs encountered sign-in/initial-load timing and a WebKit protocol-interception hash mismatch. The harness now hashes the actual browser File when stubbing extraction. Cleanup originally attempted DELETE on empty immutable ledger tables (denied by existing grants); it now cleans only the disposable tables it creates. Every test-created account was removed; no grants, immutable triggers or real records were changed. Final complete hosted runs, including cleanup, exit successfully.
- Documented limits: bounded conversational edits, no automatic merge of partial screenshots sharing one order, no visual inventory search or automatic product-photo cropping, tab-scoped draft recovery, in-process extraction cache/rate accounting, and no automated orphan-image retention job. Full screenshots are private source evidence; inventory product photos remain managed by the existing editor. See `docs/ASSISTANT.md` for details.

### Exact continuation point and remaining acceptance work

1. **Do not restart milestones 1–5.** Read this section and `docs/ASSISTANT.md`, inspect recent commits and the inherited uncommitted Auth/configuration/documentation scripts, and preserve them. Continue only with GPT-6.1 Sol explicitly selected and available; this session did not independently verify serving-model identity or switch models.
2. Set server-only `OPENAI_API_KEY` securely in the existing environment and restart. Leave the configured model at `gpt-4.1-mini-2025-04-14` unless explicitly choosing another officially supported vision/structured-output model. This application extraction setting does not change the implementation-session model requirement.
3. Verify the **unmocked** extraction endpoint with real Depop/Vinted sale/listing screenshots: single and multiple images, absent fees/shipping, accepted offers versus completed sales, ambiguous matches, multi-item orders, duplicate uploads and corrections. Review all proposals before approving any real business records. Record exact outcomes; do not infer vision accuracy from existing fixtures.
4. Test on an actual iPhone/PWA over HTTPS, including photo-library format/permissions, keyboard, long batch review, tab recovery, sign-out and responsive approval. Current Chromium device emulation and mobile WebKit checks are useful but not actual-device verification.
5. Re-run relevant checks only for new changes/failures. For hosted assistant verification after a new build, run `node --env-file=.env.local --experimental-strip-types scripts/verify-assistant-hosted.mjs`; it creates and removes only its disposable data. Broader deployment and the owner's normal password retry remain separate earlier tasks. Do not automatically deploy, push, replay migrations or implement the deferred Inventory → For Sale → Sold → Shipped pipeline.

The final checkpoint selectively stages assistant changes while preserving unrelated working-tree changes from before this task. New assistant documentation/configuration additions are committed without sweeping in the earlier Auth edits. No credentials, private screenshots or runtime environment files are tracked. No changes have been pushed.

### Live OpenAI vision verification — November 9, 2026

The user added `OPENAI_API_KEY` to the existing ignored `.env.local` and authorized live screenshot-sales verification. Confirmed presence only (no key output), file permissions `0600`, Git exclusion, and absence of the exact key bytes from tracked files and `.next/static` browser assets. A fresh isolated production server on port 3153 read the key and reported `gpt-4.1-mini-2025-04-14`, batch limit 10. No model/configuration change or application-code fix was required.

**Live OpenAI requests are now verified**, separately from the earlier mocked tests. The opt-in `scripts/verify-assistant-vision.mjs` renders three clearly labeled fictional receipt images, uploads them through the actual browser attachment/compression flow and authenticated `/api/assistant/extract` route, and receives real Responses API output. No provider response is mocked:

- Completed Vinted example: title, listing/SKU/order IDs, USD, date, $45 price, $4 seller fees, $3 seller shipping and all explicitly displayed zero amounts were read correctly. Exact identifiers selected the intended in-memory inventory item and retrieved its $12 stored fixture cost. The actual UI displayed **$26 net profit**, using the existing financial logic.
- Completed Depop example with omitted charges: absent fees/processing/shipping/discount/refund/other amounts remained null, so that row stayed unresolved with provisional profit.
- Accepted offer awaiting payment: the model returned no sale records and explicitly explained that it was not completed. An initial harness assertion expected an offer row and was corrected to accept the safe empty-record response; this was a test expectation issue, not an application defect. The final complete live run passes.
- Only the fully known completed sale was ready for approval. No Approve button was clicked. The harness blocks business/photo/approval write routes and confirmed that none were attempted. SHA-256 comparisons of the real private workspace and owner photo listing, plus the financial-audit count, were unchanged before/after analysis. The temporary real owner Auth session was revoked locally without signing out other sessions; no email was sent and no owner password was accessed.

**Important scope limit:** no genuine marketplace screenshot was attached, and read-only inspection found the real private workspace uninitialized/empty (no saved items, listings or orders). The test inventory was supplied only to an isolated browser GET response and never inserted into Supabase. Therefore this verifies live image understanding and matching/profit behavior against known in-memory records; it does **not** establish a match to the user's real inventory or accuracy across genuine Depop/Vinted screen layouts. Do not describe the rendered test receipts as real orders.

Artifacts are ignored under `test-results/live-vision/`: rendered PNG inputs, real extracted JSON, pending preview metadata, a review screenshot and the summarized result. No API key or session token is included. The review screenshot may contain the private app's normal profile UI and must not be published. The reproducible harness is opt-in and makes real billable OpenAI calls:

```bash
node --env-file=.env.local --experimental-strip-types scripts/verify-assistant-vision.mjs
```

Checks run in this follow-up: live authenticated three-image OpenAI/browser test **passes**, read-only no-write comparison **passes**, key exposure checks **pass**, ESLint **passes**, all **110 unit/database tests pass**. Production application code was unchanged. A fresh production build with the configured key passes, and the key is absent from the newly built browser assets; the earlier 24-browser regression results remain applicable. No hosted schema/Storage/business records were added or changed, and nothing was pushed or deployed.

**Next acceptance steps:** use a genuine sale/listing screenshot and saved inventory with a known purchase cost, inspect actual extracted values/matches, and leave pending until the owner approves. If inventory is absent, match manually/create a proposed item and enter its real acquisition cost/date; never fabricate cost basis. Actual iPhone/PWA-over-HTTPS acceptance also remains outstanding. The API-key setup step in the prior checkpoint is now complete. Start/restart the regular app to use the updated environment; the isolated verification server stops after testing.

The regular local production app was started on `http://127.0.0.1:3100` after the fresh build so the owner can use the new environment. The isolated verification server on port 3153 was stopped. No hosting deployment was made.

## Inventory pipeline — implemented and verified (November 9, 2026)

The user has now explicitly authorized the previously deferred Unlisted → For Sale → Sold → Shipped feature, including the shared Cost / Sale Value / Profit toggle. Earlier roadmap exclusions remain historical. Work is on `feat/inventory-pipeline`, based on assistant checkpoint `3dc3540`. No model switch or delegation was performed; serving-model identity remains independently unverifiable. The pre-task working tree and untracked files are preserved in `.git/checkpoints/pipeline-start-20261109T203223Z/` (ignored credentials excluded).

### Checkpoint 1 — lifecycle and financial selectors

- Added a pure selector based on orders/physical returns, active listings and existing dated ledger postings. Archived items are excluded, current sales override stale listings/status, returns require explicit restocking or a new active listing, cancellations restore available inventory, and resale uses only the current sale cycle. The asking price is the lowest positive active listing price per physical item, with an explicit item asking-price fallback. Values never sum cross-listed prices.
- Cost/Sale Value/Profit preserve integer cents and ledger allocations. Missing expected prices/costs/estimated expenses are excluded with completeness counts. Unsold profit requires an explicit per-item estimated selling expense (including confirmed zero); existing unconfirmed sale amounts are provisional. Merchandise value excludes buyer shipping/tips; refunds/adjustments with ambiguous merchandise-versus-other-income attribution stay unavailable instead of guessed.
- Added optional item-level fulfillment and financial-amount confirmation fields on orders, preserving legacy order-level fulfillment. Item handover has an explicit distinction; legacy in-person completion is labeled fulfilled in person. Partial item fulfillment is restricted to orders outside whole-order packages. Existing package updates remain authoritative for grouped orders. No completion date is invented for older records.
- Added an additive, locally CLI-created migration `20261109203443_inventory_pipeline_fulfillment.sql`: two order columns, a service-role-only invoker wrapper around the existing revision/ledger transaction, and schema-4 readiness. No new tables or financial formula changes. Hosted application is still on schema 3 at this checkpoint; do not use the updated private app until the new migration is verified/applied. The existing three hosted migrations have different recorded versions; do not replay them.
- Validation: baseline 110 tests passed; selector/command/PostgreSQL tests now pass **125 tests**, plus typecheck and lint. Coverage includes all three metric modes, missing estimates, cross-listing, partial refunds, negative profit, partial/grouped fulfillment, in-person handover, returns/cancellations/resale, Whatnot reservation, screenshot imports, command consistency, migration round-trip and invalid-input rollback. A fixture-ordering assertion and lint issue were corrected during test development.
- Next: build the compact Home widget/toggle, integrate query filters into Inventory/Sales, add item-fulfillment controls and settings, then run desktop/mobile browser tests, verify/apply only the additive hosted migration, test hosted round-trip without business-data changes, and create the final checkpoint. Assistant and inherited Auth work must remain intact.

### Checkpoint 2 — pipeline UI, integration and verification complete

Implemented the responsive four-stage Home widget below the financial KPIs. One Cost / Sale Value / Profit segmented control changes every stage immediately, defaults to Sale Value and persists only for the tab session. Physical counts stay visible; estimates, unknown values and provisional financial results have explicit labels. Optional marketplace details explain overlapping listing counts. The Home date filter never changes the current operational snapshot. Settings can hide the widget and configure an explicit combined selling-expense estimate per item.

Stage cards link into existing Inventory/Sales using `?pipeline=unlisted|for-sale|sold|shipped`; reload preserves the filter, and Clear pipeline filter returns to the ordinary view. Sales stage rows identify individual physical pieces, original orders, sale dates, costs, ledger profit and fulfillment. New item-level fulfillment controls support partial shipment, delivered pieces and explicit handover without adding expenses. Existing whole-order packages remain authoritative; no new navigation page or redundant summary tables were added. See `docs/PIPELINE.md` for precedence, return/restock/resale behavior, asking-price fallback, zero/missing costs, provisional amounts and ambiguous refund attribution.

Hosted schema and persistence:

- Applied only the new additive migration after local PostgreSQL tests: local `20261109203443_inventory_pipeline_fulfillment.sql` → hosted **`20261109204051`**, name `inventory_pipeline_fulfillment`. The existing migrations remain recorded as `20261109162814` initial, `20261109162836` auth_storage_hardening, and `20261109162901` financial_ledger_shipments. Reconcile this mapping before any future CLI push; **do not replay/reset already applied files**.
- Readiness reports schema **4** with every RLS/RPC/private-photo/ledger/shipment/item-fulfillment flag true. The application and `supabase:verify` both require version 4. The migration adds two order metadata columns and a restricted transactional validation wrapper around the existing commit implementation; financial formulas and history remain unchanged.
- Executed `docs/PIPELINE_ROLLBACK_CHECK.sql` against hosted PostgreSQL: synthetic partial fulfillment and confirmation metadata survive the transactional save/load, stale revisions are rejected, and client writes/RPC execution remain restricted. The transaction rolled back all synthetic records. Hosted security advisor before/after reported only the preexisting Auth leaked-password-protection warning; no new schema/RLS issues. No Auth plan/settings were changed.
- The existing hosted assistant harness now optionally accepts `HOSTED_BROWSER=chromium` and `HOSTED_CHROMIUM_EXECUTABLE`, retaining WebKit as its default. **The complete Chromium run passes** against real Supabase with a disposable account: password sign-in, review without business writes, batch listing/new-item approval, stored cost/$26 sale profit, sold/cross-listing updates, lost-response retry, repeated-screenshot rejection, private source storage/anonymous denial and sign-out. Extraction is deterministic/mocked; no additional OpenAI calls were made. All synthetic rows, private images, sessions and disposable accounts were removed. A final read-only check confirms workspaces **0**, items **0**, orders **0**, financial-audit rows **0**; the real owner account was preserved.

Checks actually run:

- Type checking passes; ESLint passes without warnings; **125 unit/database tests pass across 10 files**; production build passes; `git diff --check` passes.
- **All 34 Playwright browser tests pass**: 17 desktop and 17 iPhone-sized Chromium cases using local Chrome, including all existing assistant/core/ledger regressions and 10 new pipeline cases. These exercise all toggle modes, nonmutation of stored financial data/statuses, session selection recovery, cross-listing, current snapshot/date independence, URL-filter reloads, partial fulfillment/handover, new purchases/listings, optional widget visibility and estimate settings. Desktop and mobile pipeline screenshots were visually inspected under ignored `test-results/`.
- The first focused browser run passed 4/10. The remaining failures were test locators and asynchronous-save assertions: the item select now uses its accessible combobox role, Add listing selects the header action, and controlled checkbox tests wait for saved state. The corrected focused run and complete 34-test run pass. No financial logic was changed to accommodate tests.
- The additional hosted WebKit attempt **did not pass**: pointer clicks on the login submit button report HTML intercepting pointer events despite correct visual bounds/DOM hit-testing. A local intercepted-Auth diagnostic reproduced the problem for desktop/mobile WebKit; keyboard submission works without an Auth request. No application Auth code was changed for this diagnostic. Chromium verifies the real hosted flow, but do not claim a fresh WebKit/Safari pass. The previously recorded successful WebKit checks remain historical evidence only.
- Test servers use isolated loopback ports (3160 demo, 3152 hosted); no tests reused the owner's development server on port 3000, which was left running. The earlier task's production server on port 3100 was stopped before the production rebuild to avoid stale assets. No deployment or Git push was performed; no credential/runtime environment files are tracked.

### Exact continuation / remaining acceptance

The requested pipeline and metric toggle implementation is complete; do not restart it or the completed assistant milestones. The first pipeline checkpoint is `684c71c`; the final UI checkpoint is titled `Add interactive inventory pipeline with shared financial toggle` (see recent Git log for its hash). Preexisting Auth/configuration/scripts/documentation edits remain preserved in the working tree and recovery snapshot; test results refer to the full working checkout.

1. Use the existing running development app on port 3000, or start the production app after verifying the latest build. No hosted web deployment was made.
2. Test on a **physical iPhone/PWA over HTTPS**, including touch/keyboard, fulfillment controls and long inventory. Current device emulation is not physical-device verification. Investigate the local WebKit pointer-automation issue separately before claiming a fresh Safari regression pass; avoid bypassing application validation to work around automation.
3. Genuine marketplace screenshot + real-inventory vision acceptance remains pending as documented above; the configured OpenAI key and earlier live rendered-receipt verification are preserved. Do not treat deterministic extraction fixtures as real image understanding.
4. Historical as-of inventory reconstruction, split item-level packages and automated marketplace fulfillment sync remain out of scope. Legacy zeros stay conservative, unknown completion dates are not fabricated, and ambiguous merchandise refunds remain unavailable. These are documented behavior, not unfinished UI milestones.
5. Preserve the existing Auth working changes and inspect Git status/recent commits before further development. Continue only with the user's requested GPT-6.1 Sol selection; this session did not independently verify serving-model identity, intentionally change models or delegate implementation.

The final local production preview was restarted after verification at `http://127.0.0.1:3100`; `/login` and `/demo` both return HTTP 200. The existing development server on port 3000 remains running. The full working-tree recovery snapshot is `.git/checkpoints/pipeline-final-89fc105/`; preserve it alongside the local commits.

## Sign-in reliability follow-up — November 9, 2026

The user reported that clicking Sign in with their existing credentials appeared to do nothing. Fresh isolated Chromium pages on ports 3000 and 3100 submitted normally with an intercepted response and no JavaScript/chunk failures, so the exact cause in the user's existing browser tab was **not established**. A request for their browser/address was pending during implementation. No owner password was requested, read, tested or reset. Existing Auth work was preserved before editing in `.git/checkpoints/sign-in-before-fix/`.

Changes:

- Added an explicit submit button and same-origin native POST fallback. If client JavaScript has not loaded, credentials are submitted to the existing Auth endpoint in the request body; they never fall back to a URL query. The same schema, owner allowlist, Origin validation and Supabase password validation apply to both normal forms and JSON requests. Password strings are not trimmed or subject to a new minimum-length policy; email whitespace is normalized.
- After enhanced sign-in, the app verifies its authenticated workspace and loads a fresh home document, avoiding a cached client-router handoff. A deliberately documented Next lint exception allows the full navigation at this authentication boundary.
- Sign-in and session verification share a 20-second abort timeout with visible retry feedback. Native field-validation errors appear inline. Cookie/session failures show an explicit message instead of silently returning to login. Native success redirects through server-side session verification; native errors use fixed error codes, never user/provider text or credentials in URLs.
- Preserved prior local HTTP cookie/origin fixes and now checkpointed the related Auth source/tests together: loopback HTTP cookies work in Safari/WebKit; HTTPS and remote hosts retain Secure cookies; HttpOnly/SameSite and owner authorization remain enforced. No schema, business records or financial calculations changed.

Verification actually run:

- Type checking, production build and lint pass; **128 unit/database tests pass** (including native POST/303 behavior, error sanitization and cross-origin rejection).
- New opt-in `scripts/verify-signin.mjs` passes against real Supabase on isolated port 3155 with one disposable account, in **both WebKit and Chromium** at mobile-sized viewports. It verifies real password sign-in and session retention/reload with JavaScript enabled **and disabled**, correct local HttpOnly/SameSite cookies, credential-free destinations, sign-out, blocked-cookie feedback and a simulated 20-second timeout restoring the submit control. The fixture account and its sessions were removed. No business writes, OpenAI requests or owner-account changes were made.
- The WebKit harness uses ordinary mouse movement/clicks at the visible button bounds; this successfully submits the actual form without force-clicking, DOM event injection or bypassing authentication. The earlier locator-level pointer-hit-testing failure was not reproduced with normal pointer input. This establishes a fresh automated WebKit sign-in pass, not physical Safari/iPhone acceptance.
- Reproducible opt-in command: `HOSTED_CHROMIUM_EXECUTABLE=/path/to/chrome node --env-file=.env.local --experimental-strip-types scripts/verify-signin.mjs`. It prints statuses only, never keys, passwords or session values.
- All **34 desktop/mobile Chromium regression tests pass again**, preserving assistant, ledger, inventory and pipeline workflows. `git diff --check` also passes.
- Rebuilt and restarted the regular production preview at `http://127.0.0.1:3100`; `/login` returns HTTP 200 with the new POST fallback. The user's existing development process on port 3000 was preserved. No deployment or Git push was performed.

Continuation: refresh the user's existing login tab (or open a new tab at the local preview URL) and retry their own credentials. Their exact browser/address and successful sign-in still require user confirmation; do not claim that their actual credentials/session were verified. If it still fails, use the now-visible message and actual address to distinguish validation, connectivity, cookie or hosted-version issues. Local changes are not automatically deployed to another web address. Preserve all earlier assistant/pipeline work and remaining unrelated working-tree edits.
