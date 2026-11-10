# Screenshot assistant

## Everyday use

Open the floating **Assistant** button or **Quick add → AI assistant** from any view. Attach JPEG, PNG or WebP screenshots with the image picker, drag/drop or paste. Up to ten images fit one batch (configurable down to one). The picker preserves bounded original JPEG/PNG/WebP pixels; it resizes or compresses only oversized images. HEIC requires exporting to JPEG first.

The assistant reads active listings, completed sales and saved-order lifecycle events (shipment/delivery, cancellation, refund and physical return). It shows one batch of proposals; it does not insert business records during extraction, matching or editing. Match suggestions from similar titles require a choice. A unique exact listing ID, product ID recorded as a listing ID, SKU or listing URL can select inventory automatically.

Active listings use compact cards, collapsed by default. Each shows a small source crop, title, marketplace, asking price, inline purchase cost and estimated gross profit. No per-item distinct-inventory checkbox is required. A unique exact match selects existing inventory. Strong approximate matches appear as **Possible existing item** and require selecting the candidate or choosing **Create different item**; shared brand/size alone remains an optional search suggestion. Exact identifier conflicts cannot be dismissed into duplicate inventory. Final **Approve All** explicitly authorizes the reviewed new physical records and produces a durable authorization receipt.

**Batch Cost** offers **Same cost per item**, **Split total cost** and **Individual costs**. Apply a value to all eligible new physical drafts, or use **Choose items** for a smaller set. Existing inventory costs and ambiguous/conflicting identities are excluded. Split allocation uses deterministic integer-cent remainders, and linked marketplace views of one physical draft receive the same cost. Each affected card shows its allocation source. Individual overrides update that physical draft's linked views and survive expansion and reload. Exact shared SKUs identify pending cross-listings automatically; when screenshots have no shared identifier, explicitly choose **Same physical item as another proposal** in the expanded inventory controls. Similar titles never silently merge physical inventory.

New acquisition dates default to the workspace's local current date, clearly labeled as assumptions accepted by final approval. A batch date picker replaces them with the user's actual acquisition date. The saved inventory notes and import receipt preserve whether the date was assumed. A provisional date assumption does not turn an optional historical listing date into a routine blocker; user-specified acquisition dates retain chronological validation, future dates remain invalid, and sale-date safeguards are unchanged. Unknown costs remain blank, intentional zero and zero-cent allocations are valid, and stored legacy zeros remain unknown unless a receipt or explicit correction confirms them.

Expand a card to correct marketplace, price, title/brand/category, size/color/condition, vintage classification, acquisition date, inventory identity and other details. Evidence, vintage discussion and diagnostics stay out of the collapsed checklist. **Review unresolved** focuses the first incomplete control, opening details only for an actual exception. The normal four-item flow needs four purchase-cost entries and one final approval. Descriptions, vintage age and original listing date are optional. **Edit** continues to support existing sale and lifecycle review.

Typical conversational corrections include:

- “The second item sold for $35.”
- “The jacket shipping cost was $5, not $3.”
- “That was Depop, not Vinted.” (asks for a record number if ambiguous)
- “The third item is the blue Nike hoodie in my inventory.” (requires a unique explicit name; otherwise choose inventory in the review)

Corrections are a bounded deterministic parser, not an unrestricted conversational agent. Unsupported requests explain the supported edits. Use **line 2** with a record number for multi-item price/match changes. Buyer-paid platform shipping is never assumed to be seller income. Arbitrary financial operations, voice and analytics chat are future capabilities.

Use Skip in expanded listing details (or the existing inclusion checkbox for sales) to exclude a record, or use the trash icon to remove one pending proposal. Clear All asks for confirmation and discards only pending drafts, keeping saved records intact. **Approve All** saves only the included ready records in one transaction; unresolved/excluded records stay in the pending batch. Cancel clears a pending batch. Missing fees, shipping, discounts and direct costs stay unknown until entered or explicitly confirmed as zero. Profit with missing amounts is provisional, and an unknown purchase cost has no calculated profit.

An accepted offer, pending payment, refund or unknown status cannot be posted as a new completed sale. Refund/return imports match an existing order and post approved dated ledger events; prior-order corrections remain in the existing ledger workflow. An existing order can be opened from the duplicate warning. The command layer continues to protect physical returns, resale dates, posted cost snapshots and cross-listing alerts.

For listings, existing inventory stays one physical item across marketplaces. Existing listing dates and original prices are preserved. The original listing date is optional. Existing dates are preserved; a new listing without a visible date is recorded at approval time and marked as inferred in provenance, without claiming a historical marketplace date. Conflicting IDs or multiple possible existing listings stay pending. The Inventory/Listings marketplace filter and summary distinguish acquisition-cost valuation from combined active listing asking prices.

## Configuration and privacy

Optional server environment variables:

| Name                      | Default / meaning                                                  |
| ------------------------- | ------------------------------------------------------------------ |
| `OPENAI_API_KEY`          | Required only for screenshot extraction; server only               |
| `OPENAI_SCREENSHOT_MODEL` | `gpt-4.1-2025-04-14`; vision and strict structured output required |
| `ASSISTANT_BATCH_LIMIT`   | `10`; clamped to 1–10                                              |

Restart the server after changes. The implementation-session GPT-6.1 Sol restriction is distinct from the application's configurable extraction model. The app never chooses an automatic fallback model. A missing/invalid API key produces a setup/error message; manual and CSV workflows keep working. `/demo` cannot spend the private OpenAI key. Deterministic tests never present fixture extraction as real AI analysis.

OpenAI requests use the Responses API with image data URLs, strict JSON Schema generated from Zod and `store: false`. Only screenshots go to extraction; the inventory workspace and cost calculations are not sent to OpenAI. See official [vision input documentation](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [the configured model](https://developers.openai.com/api/docs/models/gpt-4.1). Provider retention rules still apply; `store: false` is not a claim of zero data retention.

Limits: original picker files up to 20 MB/40 million pixels; prepared images up to 5 MB, bounded to a maximum 4,096-pixel edge and 16.7 million pixels; actual multipart request bounded to 16 MB. Server decoding rejects corrupt, animated and oversized images before API spending. An in-process bounded cache retains parsed extraction promises for ten minutes per owner/model/hash and collapses concurrent duplicates. Twenty uncached attempts per owner per minute are allowed per process. Multi-instance shared caching/rate accounting is a future scaling concern. Provider failures are sanitized and retain attachments for retry.

Before approval, image bytes remain in memory/object URLs; validated extracted/corrected metadata is stored in owner-scoped tab session storage under `thrift-log.draft.assistant.*`. Sign-out clears that namespace. This is tab recovery, not cross-device draft sync. Closing the panel keeps the in-memory chat; refreshing restores the pending batch. Browser storage restrictions may prevent recovery, so keep the tab open until saving. Images themselves are not put in JSON or session storage.

After explicit approval, available source screenshots are uploaded once per batch to the existing private `inventory-photos` bucket and referenced from the import audit. The server checks ownership and verifies SHA-256 against the stored bytes before committing business records. Read access uses the existing authenticated photo route and short-lived signed URLs. If a page was refreshed before any screenshot upload, provenance can still retain the source hash and extracted facts; reattach the original before approval to preserve its image too. Review cards show a private source crop when the model supplies a valid card region; this is source evidence, not a separately saved product photo. Image-embedding inventory search is not implemented; matching uses exact identifiers and visually informed descriptive attributes. Add standalone product photographs through the existing inventory photo editor. Full order screenshots are kept as private source evidence rather than automatically exposed as product photos.

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

## Clothing and marketplace review

The full image is always sent as high-detail vision input. High-resolution screenshots above 2,000px (with both edges above 600px) include four overlapping 60%-size detail windows in the same request. Labels distinguish those windows from new products. The server normalizes EXIF orientation, keeps original upload hashes, and records actual model/input dimensions/views. No filename or another screenshot supplies marketplace identity.

Separate listing cards produce separate editable records. Multi-piece sale orders retain shared charges once. Each record exposes brand, garment type, color, size, condition, asking/sale price, graphics/lettering, fit and vintage assessment. Expand visual evidence to distinguish readable text, appearance, uncertain observations and unknown attributes. Original marketplace text is separate from the descriptive title. Missing materials, labels, dates and costs are not invented.

Marketplace identity includes qualitative confidence and visible interface evidence independently for each source image. Cropped, unrecognized or conflicting interfaces need explicit confirmation in Edit. Mixed batches preserve each source image/platform. If a request mentions one marketplace and image evidence differs, the batch asks for confirmation rather than overriding the screenshot; a request naming multiple platforms sets no batch-wide default. Identifying a platform never supplies assumed fees.

Vintage assessments are editable. Model-confirmed vintage claims are conservatively downgraded to potentially vintage; verified age needs the owner's explicit confirmation and written age evidence. Appearance and design copyright dates alone cannot establish manufacture age. Upload neck-tag/care-label close-ups when needed. Full original and corrected metadata are retained in existing private import provenance; new inventory descriptions contain a compact summary. Linking an existing item does not overwrite its core attributes.

To attach a listing to known inventory, open that item’s editor and select **Scan Listing for This Item**. One listing links directly to that item. Multi-card screenshots start excluded: choose the card belonging to the selected item. This path cannot create or retarget physical inventory or overwrite SKU/photos/sourcing. Acquisition cost stays protected unless **Correct cost** explicitly proposes a correction for approval. Use **Use general import** to leave the item context; cancel/finish an existing draft before starting a different scan.

### Actual-image benchmark

The supplied four-item expectations live only in a test fixture, never in production extraction. The original screenshot must be provided separately; writing expected facts does not supply image pixels.

```bash
RUN_LIVE_VISION=1 \
VISION_SCREENSHOT_PATH='/absolute/path/to/actual-vinted-screenshot.png' \
VISION_EXPECTED_PATH=tests/fixtures/vision/vinted-four.expected.json \
npx vitest run tests/assistant-vision-live.test.ts
```

This opt-in test loads the ignored local environment, makes a billable real vision request, reports each expected field independently, creates editable in-memory drafts and verifies prepare does not mutate business state. It never approves or connects to the business database. Private extraction/processing results are written under ignored `test-results/vision-live/report.json`; keep that directory private. Use separate expectations for each actual marketplace screen, including `marketplace: null` for genuinely ambiguous screenshots. Run one supplied source at a time; deterministic tests separately cover mixed-batch propagation and source associations.

**Current acceptance gap:** no actual four-item image or representative Vinted/Depop/eBay/Whatnot screenshot set was attached in this session. Real garment recognition and mixed-marketplace accuracy are pending those inputs. A synthetic text receipt verifies API/schema/financial integration only, and may correctly require marketplace confirmation because it lacks authentic UI. Older synthetic-receipt harnesses expecting automatic platform assignment need that explicit review step. Do not call either mocked cards or rendered receipts a successful real-marketplace benchmark.

## Inline listing review

Each collapsed listing card exposes **Purchase Cost ($)**. Expand its chevron to edit **Listing Price ($)**, **Marketplace** and other extracted details without opening a separate dialog. Cost inputs start blank when unknown, use the mobile decimal keyboard, accept at most two decimal places and store cents. An entered `0` is a known zero; clearing the field returns it to unknown. Invalid/incomplete currency text stays in the tab draft and blocks that row’s approval rather than silently rounding or saving zero.

Matched inventory uses its stored acquisition cost. Choose **Correct cost** to propose an explicit correction, or **Cancel cost correction** to keep the stored amount. Approval applies the existing validated inventory command; historical sale cost snapshots, SKU, photos and sourcing history are preserved. Cross-listed proposals cannot specify conflicting acquisition costs for the same physical item. An intentional cost correction can accompany an otherwise unchanged existing listing without adding a duplicate listing.

**Potential gross profit** is asking price minus known acquisition cost. Unknown cost displays **Cost needed**. If Settings has a known estimated selling expense per item (including an explicitly configured zero), **Estimated net profit** separately subtracts that expense. These estimates do not become earned revenue, realized profit, ledger events or marketplace fees. Negative potential values are displayed normally.

Use **Edit additional details** for title, brand, category, garment type, size, color, condition, vintage, date, identifiers/URL, description and notes. Original visual evidence and marketplace identification remain separate. Notes save on new inventory; corrections and notes for matched inventory stay with the import provenance, avoiding silent changes to existing descriptive/history fields. New physical items still require explicit distinct-item confirmation, SKU and acquisition date as well as a known cost. Entering a cost alone never creates inventory.

Edits survive card expansion/collapse and tab reload through the existing pending-draft storage. **Approve All** remains in a reserved footer outside the scrolling review, approving only included ready records. Incomplete rows remain pending. No permanent records or source screenshots are saved during editing.

## Smart batches and inventory lifecycle

Each source screenshot is classified independently. **What happened?** shows the detected action and qualitative evidence, and allows corrections before approval. Clear active listings propose For Sale; clear paid sales propose Sold; shipping/delivery confirmation updates an existing order to Shipped. Offers, negotiations, carts, unaccepted labels and ambiguous screens remain unresolved. Detecting a marketplace never supplies assumed fees. Item/order matching uses existing IDs first, then reviewable candidates; no new physical item is created for a shipment or return.

Empty/generic listings, incomplete edge cards and reliable repeated views do not become actionable product drafts. Informational notes explain omissions. Blank product placeholders on order events are removed; an order-only confirmation may contain zero identified products and still match its existing order/tracking ID. Original order lines, not an invented product, determine the physical pieces. Older saved tab drafts are filtered on restore while preserving valid corrections and source indices. A model’s free-text product count is replaced when evidence filtering changes its output.

Mixed batches retain separate source hashes, marketplaces, event types and operations. Listings and sales are planned before dependent fulfillment events regardless of upload order. The review can link to a proposed sale in the same batch; that shipment cannot commit on its own if the required sale is excluded. Repeated order IDs, source receipts and conflicting listing views stay unresolved rather than creating duplicate transactions or silently overwriting a price. Unresolved drafts retain the database-confirmed revision after a partial approval.

Optional listing dates, vintage age and existing inventory cost do not prevent an otherwise valid existing-item listing. Unknown costs remain visible as unknown; new physical listings require a known acquisition cost and a valid acquisition date (the labeled date assumption is accepted by final approval). Plausible matches require a specific candidate decision; final approval authorizes new inventory when no conflict remains. Unverified vintage claims remain potentially vintage. Optional garment observations do not require a financial-warning acknowledgment, while financial/unknown warnings and missing monetary values still protect sales and adjustments.

### Fulfillment and accounting

After a sale is confirmed saved, **Mark Shipped** updates that order through the existing command layer; in-person sales use **Mark Fulfilled** and record handover. Multi-piece orders allow selecting the affected pieces. Grouped packages require explicit confirmation before changing their other orders; existing package IDs, tracking and allocated costs are preserved. Delivered pieces never regress to shipped. No expense is fabricated. If the screenshot supplies tracking but no known label cost, tracking is retained in private import evidence and dates are saved with order/item fulfillment; the app does not invent a zero-cost shipment. Observed known label costs remain unallocated unless reconciled through the existing shipping ledger.

Refunds never automatically restock items. A physical return needs explicit confirmation that the items were received. A verified refund can be included with that return using its explicit checkbox; already-recorded refunds are blocked from being duplicated, and the physical receipt can proceed separately. Both use existing immutable dated ledger events and exact-cent allocation rules. Unfulfilled cancellations use the existing order command and restore available inventory to Ready to List. Fulfilled orders or protected financial histories require reconciliation rather than being rewritten.

### Conversation commands

- **Log all these / Approve everything:** reports ready records and directs the user to the authoritative Approve All control; a chat message never silently commits.
- **Add all these to listed:** prepares applicable selected listing/ambiguous records, preserving completed sales and fulfillment events.
- **Remove the fifth item:** removes only that numbered pending row; the source index and other drafts stay intact.
- **The second item cost me $8:** proposes the exact-cent acquisition cost, clearly marking an existing-item correction for approval.
- **Change the first listing to Depop:** preserves source evidence and updates the pending marketplace.
- **The third item sold:** proposes a sale and requests actual sale date/price/selling amounts; asking prices are not assumed to be proceeds.
- **Mark the Nike hoodie shipped:** resolves a unique saved physical piece/order, prepares fulfillment and requires review/approval. Ambiguous names ask for a title/SKU. Unsaved sales must be approved first.

Conversation-only events are explicitly labeled as user requests, have no invented screenshot reference and use the same authenticated, revision-checked approval endpoint and existing commands. Trash/Clear All never delete inventory, sales or ledger history.

Current limitations: live acceptance on the original four-card Vinted image and representative real mixed-marketplace screens is still pending actual image files. Generated receipt/shipment images are protocol smoke tests only. Physical iPhone/Safari testing is separate from mobile-sized Chromium automation. The application extraction model remains configurable; retaining full GPT-4.1 after fixing application validation is not a claim that a model upgrade was benchmarked or would solve these issues by itself.

Hosted verification note: normal `verify-assistant-hosted.mjs` runs avoid immutable financial postings and clean up their fixture using the service API. The optional refund/return/cancellation posting exercise requires `HOSTED_LEDGER_POSTINGS=1` **and** `HOSTED_LEDGER_ADMIN_CLEANUP_READY=1`, with a verified database-admin cleanup path already available. Service REST credentials intentionally cannot delete posted ledger records. Use local PGlite tests for routine immutable-ledger regressions. Do not enable or replay the optional hosted posting exercise merely to rerun UI tests. The current test-fixture cleanup issue and exact continuation state are recorded in PROJECT_STATUS.md.
