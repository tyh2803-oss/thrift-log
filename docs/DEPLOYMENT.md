# Deployment and hosted verification

Hosted application is delegated to authenticated local Codex; start with [LOCAL_SUPABASE_HANDOFF.md](LOCAL_SUPABASE_HANDOFF.md). These files are prepared and locally tested, not confirmed applied remotely.

1. Commit the source and lockfile to your GitHub repository using your usual review workflow. The starting repository had no commits or branches; this task has not pushed source or created a pull request.
2. Create a Vercel project from this repository. Framework: Next.js. Root: repository root. Node: 24.x (22+ supported). Install: `npm ci`. Build: `npm run build`. No custom output directory is necessary.
3. Open the existing Thrift Log Supabase project and inspect its schema/migration history. If not already applied, run `202611090001_initial.sql`, `202611090002_auth_storage_hardening.sql`, and `202611090003_financial_ledger_shipments.sql` in order from `supabase/migrations/`. Only apply the initial schema to an uninitialized project; reconcile an existing divergent schema additively. Never replay an already-applied migration. The SQL creates the private `inventory-photos` bucket. No public Storage policy is installed.
4. Disable public account signup. Confirm the existing owner account; create one only if absent. Manage passwords through Supabase Authentication without resetting an existing account as a setup shortcut.
5. Set the four variables from `.env.example` in Vercel settings. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are public project configuration. `SUPABASE_SERVICE_ROLE_KEY` is server-only and privileged; `OWNER_EMAIL` restricts app sign-in to the owner. Never add them to Git. Set Supabase's site URL to the deployment URL. The implementation uses password auth, not an OAuth callback.
6. Deploy over HTTPS. A Vercel credential is not needed to prepare this repository, but deployment itself requires your account authorization.
7. In a new browser context, verify password sign-in, persistence after reload, item/photo creation, listings on two marketplaces, one sale, a manual-delisting alert, a refund, a time session, a CSV reimport, and financial reports. Sign out and verify APIs/photos are inaccessible. Open a second account and verify RLS prevents access. Local database tests do not replace these service checks.
8. Install using iPhone Safari → Share → Add to Home Screen. Check safe areas, file/photo upload, timer after screen lock, and offline fallback. A PWA cannot guarantee automatic background geofencing.

## Cloud task configuration

Use `npm run supabase:verify` for read-only checks of configured project access, schema/RLS, RPC grants, private photo storage, and owner-account presence. Session-refresh proxy tests and storage-route tests are locally simulated; hosted sign-in and photo persistence still need verification.

The reusable install/start fields are saved in the cloud environment draft. Saving the draft does not publish, deploy, or restart anything. Review and save them in environment settings, then publish the prepared environment if desired. Live processes do not survive snapshots; future tasks must run the saved startup instructions.

The environment is isolated. Use the existing `/workspace/thrift-log` checkout; do not create a worktree unless specifically requested. Dependencies, build outputs, and source files are filesystem state; server processes must restart. This repository began unborn and no remote source publication has been performed. Fresh-task restoration has not been independently verified.

## Networking

Package-manager destinations were already permitted. Additional custom domains were saved for `developers.whatnot.com`, `api.whatnot.com`, `developer.ebay.com`, `api.ebay.com`, and `auth.ebay.com`. Saving did not make documentation access work in this running instance; the observed response remained HTTP 403. The supplied MCP URL identifies project `gvwgasebholdawlakwdf`; its hostname `gvwgasebholdawlakwdf.supabase.co` and `mcp.supabase.com` are now also saved in the draft. Actual project/MCP requests remain blocked in the current runtime. MCP tools and application runtime keys are not available here yet. Do not replace an unknown network allowlist or disable TLS verification.

## Backups and operations

Export working data regularly and use Supabase's available database backup options. Order/line changes have an audit trail and application workflows archive/cancel rather than deleting financial history. Photos and original CSV imports are private business data; include their storage in your backup plan. The current single-owner aggregate loading/transaction model is intentionally simple; very large histories will require paginated read models and incremental mutations before hitting hosting request-size limits.
