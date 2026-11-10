# Codex Cloud continuation

Use branch **`feat/codex-cloud-handoff`**. This integrates the existing assistant, inventory pipeline, authentication and local HTTPS work. Do not restart those features. Read `PROJECT_STATUS.md`, `AGENTS.md` and the relevant installed Next.js guides before editing. The November 10 handoff authorization permits this feature-branch commit/push; earlier status entries prohibiting commits describe previous sessions. Main has not been merged or changed.

## Environment and checks

- Use Node.js 22 or newer and `npm ci`. Dependencies are pinned by `package-lock.json`.
- Mac `.env.local`, private keys, screenshots, browser storage and `.git/checkpoints/` archives are not transferred to GitHub or Cloud. Configure the variables named in `.env.example` through the Cloud environment's secure settings. Never commit credentials. Confirm secrets are available to the process running the app, not only the environment setup step.
- Allow the exact configured Supabase project hostname and `api.openai.com` when testing private services. Without credentials, use `/demo`; never present demo or mocked extraction as real business data.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then browser tests. Install Chromium with `npx playwright install chromium` if needed. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the actual installed executable and `PLAYWRIGHT_PORT` to an unused port. Browser tests use a separate production demo process with private credentials cleared.
- The Mac LAN URL `https://192.168.18.125:3000/login` and its private CA are local to that Mac/Wi-Fi. They do not become a Cloud deployment. See `LOCAL_HTTPS.md` for local device testing; do not copy private CA/server keys into Cloud.
- Hosted Supabase migrations are already applied. Verify project `gvwgasebholdawlakwdf` and the migration-version mapping in `PROJECT_STATUS.md` / `LOCAL_SUPABASE_HANDOFF.md`. Do not replay migrations, reset storage or change production protections.

## Last completed implementation

The assistant supports clothing/marketplace extraction, inline cost/price/platform review, exact-cent previews, inventory matching, lifecycle proposals, batch approval, draft removal/clearing and post-sale fulfillment. Mutations require explicit approval and authoritative validation. Unknown costs remain different from zero; existing physical inventory identity and immutable financial history are preserved. The Home pipeline has Cost / Sale Value / Profit and filtered stage navigation. Authentication retains secure production cookies; local HTTPS enables native browser cryptography.

Pending drafts are stored in scoped session storage and survive closing/reopening the panel. General conversation history, generalized business questions and model-driven read tools are not yet implemented. Do not describe the larger business-aware assistant mission as complete.

## Next implementation phase: business-aware assistant

This phase stopped at a read-only audit when the user requested the Cloud handoff. No runtime model, environment, business records or schema was changed for that phase.

1. Finish the gap audit of existing assistant components/routes, command layer, matching, ledger, authorization, draft persistence and tests. Reuse the completed workflows.
2. Recheck official API model documentation and project access before upgrading. During the local audit, official documentation identified `gpt-6.1-sol` and an authenticated model-metadata GET returned HTTP 200 with that exact ID. **No inference request with that model was performed, and it is not enabled in the app.** The runtime remains `gpt-4.1-2025-04-14`, configured by `OPENAI_SCREENSHOT_MODEL`; `OPENAI_ASSISTANT_MODEL` and usage/cost logging are not implemented yet. Verify a real structured multimodal Responses request before claiming support. Do not silently fall back or conflate the development agent's identity with the runtime model.
3. Add narrowly scoped, server-authorized typed business read tools, conversational intent/draft editing, bounded persistent context, and missing validated action proposals. Preserve explicit authoritative approval, duplicate/revision checks and existing financial calculations.
4. Add token-usage and pricing estimates without logging secrets, private prompts or screenshots. Reverify official model pricing at implementation time.
5. Obtain the actual four-card Vinted screenshot and authentic mixed-marketplace images. Only expected facts (test JSON), not the original pixels, are present. Run the opt-in field-level benchmark documented in `ASSISTANT.md`, then complete mobile/browser and physical Safari acceptance. No benchmark facts are hardcoded in production.

## Outstanding isolated hosted test fixture

One previous optional immutable-ledger test passed its business assertions but failed cleanup. The normal hosted test was subsequently fixed and passed with complete cleanup. Do not rerun immutable posting tests without verified admin cleanup capability.

The remaining account is synthetic and disabled, with sessions revoked and its screenshot folder verified empty. No owner records are targeted. Its identification is recorded here because Mac-private checkpoints will not be available in Cloud:

- Project: `gvwgasebholdawlakwdf`
- Synthetic user ID: `e41bec9d-f28e-44be-acdb-633fc31bc0c7`
- Synthetic email: `thrift-assistant-0c136741-58b1-43e9-aa6b-e3622289832a@example.invalid`
- Created: `2026-11-10T16:31:26.505257Z`
- Last verified scope: two fixture inventory items, two fixture orders and their protected financial/return records; metadata `thrift_log_test_fixture=true`, `cleanup_pending=true`.

Supabase MCP admin access failed with `OAuth token refresh failed: Failed to parse server response`; no working direct admin DB connection was configured. The normal service API intentionally cannot delete immutable ledger entries. Reconnect admin access, verify the project, exact disabled fixture identity, current rows and foreign-key dependencies before preparing a bounded cleanup. Preserve all ledger/RLS/role protections. If safe administrative cleanup is unavailable, leave this account disabled and report the limitation. Never broaden predicates, delete the owner, or enable normal deletion of posted ledger entries. Verify zero fixture rows/storage/sessions before deleting only this synthetic Auth account.

A guarded cleanup plan and exact verification metadata remain on the Mac under `.git/checkpoints/smart-imports-cleanup/`; the plan has **not** been executed and is not pushed. Do not assume those private files exist in Cloud. The public repository contains no admin credentials or automatic cleanup bypass.

## Acceptance limits

Prior real OpenAI tests used explicitly synthetic sale/shipment images; prior hosted persistence tests used disposable accounts. They do not establish authentic marketplace accuracy. Physical iPhone/Safari acceptance and the original four-item image benchmark remain outstanding. Positive responsive tests are desktop/mobile-sized Chromium; exploratory WebKit automation failures are documented in `PROJECT_STATUS.md`.
