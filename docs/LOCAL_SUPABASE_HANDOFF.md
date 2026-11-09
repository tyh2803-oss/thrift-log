# Local Codex / authenticated Supabase MCP handoff

The owner will apply and verify hosted Supabase changes from local Codex. Cloud development must continue without attempting to transfer MCP OAuth credentials. None of this repository's migrations is confirmed applied to the hosted project.

## Target and preservation

- Existing project reference: `gvwgasebholdawlakwdf`.
- Intended application URL: `https://gvwgasebholdawlakwdf.supabase.co`.
- MCP URL: `https://mcp.supabase.com/mcp?project_ref=gvwgasebholdawlakwdf`.
- Use the existing checkout. Preserve application progress, existing data, migration history, and `.env.local`. Do not reset the project, replace databases, create new projects, push source, or rotate secrets as a setup shortcut.
- MCP authentication is for the developer tools. The Next.js app still needs its own securely configured runtime URL, public/anon key, server key, and owner email.

## Inspect before applying

Use the authenticated local Supabase MCP tools to identify the project and confirm its reference. Inspect project status, applied migration history, existing public schema, RLS policies/grants, Auth signup settings, Storage buckets and all applicable Storage policies. Never print API keys, tokens, passwords, or private records.

Do not apply the initial migration to a project that already contains this schema. Compare existing objects and history with these files first. If the project has diverged, create an additive migration to reconcile the difference; do not overwrite or delete existing business records.

## Apply only missing migrations, in order

1. `202611090001_initial.sql`: original inventory, listing, order/line, expense, time, show, source, import, workspace and audit tables. Owner RLS; service-role-only transaction/load RPCs; private inventory photo bucket.
2. `202611090002_auth_storage_hardening.sql`: private bucket limits, owner-scoped Storage reads, restricted internal functions, and a service-role-only readiness RPC.
3. `202611090003_financial_ledger_shipments.sql`: immutable dated financial events and physical returns; actual payout receipts and allocations; grouped shipments; scoped RLS; compatible workspace RPCs. Original implementations move to the unexposed `thrift_log_private` schema. Existing sales and original migrations remain intact.

Use real migration operations so the backend records application. If the MCP tool assigns a migration version different from the filename, record that mapping in a verification log and reconcile it before later CLI pushes; do not replay an already applied migration. All statements in each file form a transaction.

`supabase/config.toml` is a local-development configuration, including disabled signup. It is syntax-checked here; the Supabase CLI and hosted settings have not been exercised. Applying SQL does not automatically apply hosted Auth settings.

## Authentication configuration

- Disable public account signup in the hosted project's Auth settings; this is a private single-owner app.
- Confirm the existing owner email/password account. Create it only if missing; do not reset an existing password without the owner's instruction.
- Set the production Site URL to the actual HTTPS deployment when deployed. Password sign-in does not require an OAuth callback. Use localhost/127.0.0.1 for local development only.
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OWNER_EMAIL` securely in local/hosting environment settings. Keep the server key server-only and out of logs/source. Preserve any existing local environment file.
- The Next.js proxy refreshes sessions before Server Components render, using HttpOnly cookies. Each data/photo route separately verifies the authenticated owner.

## Storage and RLS verification

Verify `inventory-photos` is private, limited to 5 MiB, and permits only JPEG/PNG/WebP. Confirm object access is scoped to the authenticated user's first path segment. Inspect other policies too: PostgreSQL combines permissive policies with OR, so an unrelated broad policy could undermine a restrictive new one. Do not silently delete other buckets' policies.

Anonymous clients must not read business tables or photos. Authenticated clients may read only their own records; direct financial writes and workspace RPC execution are denied. The privileged server path supplies the authenticated owner's ID itself. The `thrift_log_private` schema must not be exposed through the Data API.

## Validate, then report evidence

1. Run `npm run supabase:verify` with the secure local environment. It reports statuses only: schema version, RLS, RPC restrictions, private bucket, owner account, and workspace loading.
2. Query `select public.verify_thrift_log();` through the authorized SQL tool and inspect actual policy/grant definitions. A readiness Boolean is not a substitute for the cross-account tests.
3. Run the app; confirm owner sign-in, wrong-account rejection, sign-out protection, and session refresh after token expiry. Confirm the separate `/demo` never enters the private database.
4. Use temporary owner test data to verify inventory/photo persistence, two marketplace listings for one physical item, a sale, a dated partial refund/return, and resale of only the returned item. Ensure another account cannot read those records or objects. Prefer rollback transactions for SQL-only isolation checks and clean up only test resources you created.
5. Verify a grouped package updates related fulfillment once and optional label allocation deducts the label cost once. Verify an actual payout receipt changes cash/outstanding proceeds without increasing profit.
6. Run local typecheck, lint, unit/database tests, build, and isolated demo browser tests. Browser tests never use the real project's runtime keys.
7. Record exact migrations applied and hosted checks passed/failed in PROJECT_STATUS.md. Only then claim hosted readiness. Local PGlite, mocked Auth/Storage, and Chromium demo checks do not establish hosted Supabase success.

The cloud environment's network/configuration draft can be reviewed separately if this environment later needs hosted access. The owner's current plan is to perform hosted setup from authenticated local Codex; do not keep blocking feature development on cloud MCP availability.
