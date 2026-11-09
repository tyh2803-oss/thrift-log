# Screenshot assistant

## Everyday use

Open the floating **Assistant** button or **Quick add → AI assistant** from any view. Attach JPEG, PNG or WebP screenshots with the image picker, drag/drop or paste. Up to ten images fit one batch (configurable down to one). The picker compresses images before analysis. HEIC requires exporting to JPEG first.

The assistant reads completed sales and active listings. It shows one batch of proposals; it does not insert business records during extraction, matching or editing. Match suggestions from similar titles require a choice. A unique exact listing ID, product ID recorded as a listing ID, SKU or listing URL can select inventory automatically.

Choose **Edit** to search inventory, compare candidate photographs/brand/size/cost/listings, correct amounts, choose the marketplace and date, or create a new physical item. Original screenshot facts and corrected facts are shown separately under **Extraction and corrections**. Stored acquisition costs are retrieved automatically. Legacy zero costs need explicit free-item confirmation or correction. New inventory requires known cost, acquisition date, SKU, title and confirmation that it is a distinct physical item. Unknown attributes remain blank.

Typical conversational corrections include:

- “The second item sold for $35.”
- “The jacket shipping cost was $5, not $3.”
- “That was Depop, not Vinted.” (asks for a record number if ambiguous)
- “The third item is the blue Nike hoodie in my inventory.” (requires a unique explicit name; otherwise use Edit)

Corrections are a bounded deterministic parser, not an unrestricted conversational agent. Unsupported requests explain the supported edits. Use **line 2** with a record number for multi-item price/match changes. Buyer-paid platform shipping is never assumed to be seller income. Arbitrary financial operations, voice and analytics chat are future capabilities.

Uncheck records to exclude them. **Approve All Ready** saves only the included ready records in one transaction; unresolved/excluded records stay in the pending batch. Cancel clears a pending batch. Missing fees, shipping, discounts and direct costs stay unknown until entered or explicitly confirmed as zero. Profit with missing amounts is provisional, and an unknown purchase cost has no calculated profit.

An accepted offer, pending payment, refunded order or unknown status cannot be posted automatically as a completed sale. Refunds/returns and prior-order corrections should be reconciled through the existing dated ledger. An existing order can be opened from the duplicate warning. The command layer continues to protect physical returns, resale dates, posted cost snapshots and cross-listing alerts.

For listings, existing inventory stays one physical item across marketplaces. Existing listing dates and original prices are preserved. A new listing needs an explicit date when none is known; the assistant does not invent historical listing dates. Conflicting IDs or multiple possible existing listings stay pending. The Inventory/Listings marketplace filter and summary distinguish acquisition-cost valuation from combined active listing asking prices.

## Configuration and privacy

Optional server environment variables:

| Name | Default / meaning |
| --- | --- |
| `OPENAI_API_KEY` | Required only for screenshot extraction; server only |
| `OPENAI_SCREENSHOT_MODEL` | `gpt-4.1-mini-2025-04-14`; vision and strict structured output required |
| `ASSISTANT_BATCH_LIMIT` | `10`; clamped to 1–10 |

Restart the server after changes. The implementation-session GPT-6.1 Sol restriction is distinct from the application's cost-efficient extraction model. The app never chooses an automatic fallback model. A missing/invalid API key produces a setup/error message; manual and CSV workflows keep working. `/demo` cannot spend the private OpenAI key. Deterministic tests never present fixture extraction as real AI analysis.

OpenAI requests use the Responses API with image data URLs, strict JSON Schema generated from Zod and `store: false`. Only screenshots go to extraction; the inventory workspace and cost calculations are not sent to OpenAI. See official [vision input documentation](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [the configured model](https://developers.openai.com/api/docs/models/gpt-4.1-mini). Provider retention rules still apply; `store: false` is not a claim of zero data retention.

Limits: original picker files up to 20 MB/40 million pixels; prepared images up to 5 MB, resized to a maximum 2,000-pixel edge; actual multipart request bounded to 16 MB. Server decoding rejects corrupt, animated and oversized images before API spending. An in-process bounded cache retains parsed extraction promises for ten minutes per owner/model/hash and collapses concurrent duplicates. Twenty uncached attempts per owner per minute are allowed per process. Multi-instance shared caching/rate accounting is a future scaling concern. Provider failures are sanitized and retain attachments for retry.

Before approval, image bytes remain in memory/object URLs; validated extracted/corrected metadata is stored in owner-scoped tab session storage under `thrift-log.draft.assistant.*`. Sign-out clears that namespace. This is tab recovery, not cross-device draft sync. Closing the panel keeps the in-memory chat; refreshing restores the pending batch. Browser storage restrictions may prevent recovery, so keep the tab open until saving. Images themselves are not put in JSON or session storage.

After explicit approval, available source screenshots are uploaded once per batch to the existing private `inventory-photos` bucket and referenced from the import audit. The server checks ownership and verifies SHA-256 against the stored bytes before committing business records. Read access uses the existing authenticated photo route and short-lived signed URLs. If a page was refreshed before any screenshot upload, provenance can still retain the source hash and extracted facts; reattach the original before approval to preserve its image too. Product-photo cropping and visual inventory search are not implemented; add product photographs through the existing inventory photo editor. Full order screenshots are kept as private source evidence rather than automatically exposed as product photos.

Successful upload references survive failed financial approvals, avoiding repeated uploads on retry. Canceling after an upload but before a failed/conflicting approval may leave a private unreferenced object; automated retention/garbage collection is not implemented. No public bucket, arbitrary SQL endpoint, database migration or marketplace connection was added.

## Approval architecture

- `src/lib/assistant/schema.ts`: strict extraction schemas; nullable facts.
- `matching.ts`: reusable exact-priority and approximate inventory candidates.
- `drafts.ts`: validated batch/row/match schemas and stable operation IDs.
- `planner.ts`: search/read helpers, duplicate checks, existing command/money validation, ready-row planning and approval provenance.
- `corrections.ts`: typed, bounded pending-draft edits; no new transactions.
- `openai.ts`: server-only Responses client, configuration, owner cache, rate guard and sanitized failures.
- `provenance.ts`: private screenshot ownership/hash verification.
- `/api/assistant/extract`: authenticated, origin-checked, bounded read-only extraction.
- `/api/assistant/approve`: authenticates, reloads current data, checks revision and duplicates, generates fixed typed operations and calls the existing transactional `commit_workspace` RPC.

The AI cannot write arbitrary commands or SQL. Final calculations use `orderTotals`, `lineProfits` and `applyCommand`, with the unchanged dated ledger and cost snapshots. Shared order fees/shipping are applied once and allocated with the existing exact-cent algorithm. Repeated screenshots/order IDs or sold physical items cannot silently create another sale. Different partial screenshots of one order are flagged for reconciliation instead of guessing how to merge charges; keep one complete extraction or use the manual multi-item order editor.

Each approved row gets a stable private `imports` receipt with `mapping.format = assistant-v1` and a batch ID. The existing `rawCsv` text field stores bounded JSON provenance for these imports: source hash/reference, original extraction, corrected values and match decisions. `recordIds` links the saved records and `importedAt` is the approval timestamp. No image data is embedded. No changes to the original CSV format are required.

Business records and their receipts commit together. A durable receipt confirms a repeated approval after a lost HTTP response. Revision conflicts do not overwrite current data: refresh, review the changed preview, choose **Use updated preview**, then approve again. Double submission is guarded in the UI/provider and database revision transaction.

## Verification and continuation

Run normal checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e
```

Vitest includes deterministic Responses service doubles, authenticated API boundary tests, matching/correction/financial/listing/duplicate tests, and PGlite migration/RPC round-trips. Chromium browser tests cover demo-based draft review, edits, recovery, failed revision/approval recovery, new inventory/listings and dashboard integration. They do not contact private records or OpenAI.

The opt-in hosted assistant harness uses an isolated production process on port 3152, a disposable account and WebKit at a mobile viewport:

```bash
node --env-file=.env.local --experimental-strip-types scripts/verify-assistant-hosted.mjs
```

It uses deterministic extraction fixtures at the browser fetch boundary, actual Auth cookies, app approval routes, hosted PostgreSQL and private Storage. It tests prepare-without-writes, existing/new listings, acquisition valuation, sale cost snapshots, cross-listing flags, durable duplicate retries, repeat screenshot rejection and private source images. It cleans only the disposable account's records/images/sessions. The configured owner's `.env.local`, password and business records are untouched. An image fixture is a tiny generated PNG; this test does not establish image interpretation accuracy.

Actual test results and checkpoint commits are maintained in `PROJECT_STATUS.md`. The local API key is now configured and live vision passes on rendered test images (see below). Remaining acceptance: genuine Depop/Vinted screenshots with saved inventory, including missing fees, accepted offers, multi-item orders, duplicates and corrections, plus an actual iPhone/PWA over HTTPS. Do not claim real vision or actual-device coverage from fixtures or emulated viewports. Do not replay existing hosted migrations, push changes or deploy automatically.

### Live vision check (opt-in)

`node --env-file=.env.local --experimental-strip-types scripts/verify-assistant-vision.mjs` starts an isolated authenticated app on port 3153 and sends three rendered fictional receipt images through the actual attachment/compression/API flow to **real OpenAI**, with no mocked extraction. Known inventory is supplied only in an isolated browser GET response; it is never inserted into the database. It checks exact matching, $26 profit on the known $45/$4/$3/$12 example, missing selling amounts remaining unknown, and accepted offers staying out of completed sales. It never clicks approval, blocks business/photo write routes, compares actual workspace/audit/Storage state before and after, and revokes only its temporary Auth session.

This harness makes billable API requests and writes ignored artifacts under `test-results/live-vision/`. Its images are test receipts, not genuine marketplace orders. A review screenshot can include the normal private profile UI; keep artifacts private. The November 9 run passes with `gpt-4.1-mini-2025-04-14`. Genuine marketplace screenshots, saved real inventory matching and actual iPhone/PWA acceptance remain separate checks; see PROJECT_STATUS.md.
