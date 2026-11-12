# Invite-only beta: rollout on the existing projects

For approved testers creating their own accounts without invitation email, use [preauthorized registration](BETA_REGISTRATION.md). It is opt-in, requires the subsequent schema-7 migration, and leaves public Supabase signup disabled. The migration/bootstrap instructions below remain the prerequisites.

This PR contains beta access and its two prerequisite migrations. The larger pending inventory-management and visual-polish changes remain separate. Nothing here automatically applies SQL, merges main, creates accounts, or deploys Production. **Database changes and merging main still require your explicit approval.**

Use the existing Thrift Log Supabase project (`gvwgasebholdawlakwdf`) and Vercel project. A separate testing database is not required for this small rollout: the migration, tenant isolation, revocation and owner-data preservation tests run locally in isolated PostgreSQL/PGlite. No unresolved security issue identified by those checks currently requires another project.

## Minimum rollout steps

### 1. Check and apply only the pending SQL — after database approval

In your existing Supabase project's SQL Editor, run this read-only check:

```sql
select public.verify_thrift_log();
```

Check migration history before running SQL. Schema 4 needs these files in order; schema 5 needs only the second. If schema 6 or later and beta checks are already present, do not rerun either migration.

1. [`202611100001_pipeline_operational_corrections.sql`](../supabase/migrations/202611100001_pipeline_operational_corrections.sql)
2. [`202611110001_invite_only_beta.sql`](../supabase/migrations/202611110001_invite_only_beta.sql)

Apply them with your existing migration tool/CLI, or paste the missing file contents into the SQL Editor. With linked Supabase CLI access, `supabase db push --linked` applies pending migrations and tracks their history; inspect its pending list first. Do not replay migrations already applied. If using the SQL Editor manually, record the applied versions in your existing migration history/workflow before later CLI pushes. Version 4's `20261109203443` migration must already exist; an older project must finish that existing setup first.

The small schema-5 prerequisite allows per-item fulfillment metadata to change on posted orders. Sale amounts, sale lines, cost snapshots and amount confirmations stay locked. Schema 6 adds the private access list, restrictive RLS on all 18 business tables, protected server RPCs and private photo proxy policies. Neither migration rewrites business records.

### 2. Authorize the existing owner before merging

Immediately after the migrations, open [`supabase/bootstrap_beta_owner.sql`](../supabase/bootstrap_beta_owner.sql) in that same SQL Editor. Replace `REPLACE_WITH_OWNER_EMAIL` **in the variable declaration** with the unchanged `OWNER_EMAIL` from Vercel, then run it. No password, new account, new key, or separate database is needed.

The script finds the existing verified Auth UUID, authorizes it, and compares the full owner workspace, revision and all 18 business-table row counts before/after. Any mismatch rolls back the bootstrap. It refuses replacing a different configured owner. Final readiness must show `schemaVersion` at least 6 (7 with registration), `inviteOnlyBeta: true`, `betaOwnerConfigured: true`, and all existing RLS/private-bucket/RPC checks passing.

**Run the migrations and bootstrap together in a short quiet window.** Schema 6 deliberately blocks private access until the owner is authorized. Do not merge/deploy the new application until the bootstrap succeeds. Existing records are retained if setup stops halfway; completing the bootstrap restores access. Keep the existing backup/recovery option available.

The guarded CLI alternative, if you already have a secure local `.env.local`, is:

```bash
npm run beta:bootstrap-owner
npm run beta:bootstrap-owner -- --apply --project-url=https://gvwgasebholdawlakwdf.supabase.co
npm run supabase:verify
```

The first command is read-only. No apply command was executed during PR preparation.

### 3. Configure invitation delivery on the same projects

In **Vercel → existing project → Settings → Environment Variables**, add `BETA_SITE_URL` for Production: your existing canonical HTTPS app origin, without a path. Keep the current Supabase variables and `OWNER_EMAIL` unchanged. Set it before the Production build following the approved merge. Preview deployments do not need permission to modify the database or apply migrations; use `/demo` before setup, and avoid real-account save tests until approved.

In **Supabase → Authentication**, keep public signup disabled, set Site URL to that same app origin, and allow its exact `/auth/confirm` redirect. In **Email Templates → Invite user**, use this link:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept Thrift Log invitation</a>
```

The application supplies `/auth/confirm` as `RedirectTo`. Keep your existing SMTP configuration if it can deliver to your friends. Supabase's restricted default mailer may require custom SMTP for external recipients; invitation delivery errors are reported without claiming success. For administrator-triggered password recovery, use the same callback with `type=recovery` in that template.

**Simple option without setting up email delivery:** after deployment, create each friend as a confirmed email/password user in Supabase Auth with a unique temporary password, authorize their email in Settings, and share only that friend's temporary credentials securely. They sign in and visit `/set-password` to choose their own password. Never reuse or share the owner's password. This uses the same access controls and avoids needing SMTP for the initial two accounts.

### 4. Merge only after approval, then add your friends

After readiness is green and you explicitly approve merging, merge this PR into main. Your existing Vercel Git integration deploys main to Production; no new Vercel project is needed.

Sign in as the existing owner and confirm the original workspace is present. In **Settings → Beta testers**, authorize each email. For new accounts with email delivery configured, click **Send invitation**; each friend follows their link and chooses their own password. Existing approved accounts sign in normally. Each starts with a separate workspace, not a copy of yours.

**Revoke access** blocks future app/database/photo requests while retaining all records. **Restore access** restores the same user's workspace. Revoke/restore one tester once to confirm the live setup, and check iPhone sign-in and a save/reload. Do not run the older hosted synthetic-account write scripts against production; they predate beta enrollment.

## Protections and limits

- Verified Supabase Auth UUIDs choose the workspace; request parameters cannot choose another user. Client/JWT user metadata never grants beta/owner rights.
- Approved emails bind once to verified Auth UUIDs. Unknown, unverified, email-changed and revoked accounts fail closed. Owner management cannot revoke or replace the owner.
- Existing tenant keys, foreign keys, financial safeguards and owner RLS remain. Live membership adds a restrictive gate on all business tables. Load/commit RPCs lock and check membership in the same transaction as a save, serializing revocation with in-flight commits.
- Photos use UUID-prefixed paths and authenticated private/no-store responses; encoded traversal and cross-user paths are rejected. Direct client Storage reads/signing are denied, preventing new long-lived links that bypass revocation. Previously downloaded bytes and old links remain usable until their existing expiry; the old app issued 60-second links.
- Private editor/assistant drafts are scoped by Auth UUID and cleared on explicit sign-in/out. Account switches remount state, stale-tab identity headers are checked, and window focus rechecks authorization. Demo data stays separate.
- Invitation OTP confirmation is server-side, allows only invite/recovery tokens, rechecks membership and uses a fixed configured callback. No public signup flow is added.

PR checks cover real local SQL migrations/role grants, overlapping business IDs across accounts, distinct financials, RLS/Storage denial, revoked API calls, protected owner bootstrap, complete owner-data preservation and financial immutability. Auth/Storage network tests use explicit service doubles. Real SMTP delivery, invitation redemption and iPhone Safari require the small live check after approved setup.

Completed checks: typecheck, lint, 210 unit/database tests (one opt-in live-image test skipped), production build and all 62 browser tests at desktop and iPhone-sized Chromium viewports.

During preparation, the configured Cloud Supabase key was rejected, so the live schema/history could not be verified from this session. That does not establish a problem with the keys already configured in Vercel. Use the read-only SQL check in step 1; no production credential changes or production SQL were performed.
