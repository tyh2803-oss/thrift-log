# Preauthorized beta registration

The owner authorizes an email under **Settings → Beta testers**. A new tester visits **Login → Create Account**, enters that exact email and their own password, and receives a separate empty workspace. No invitation is required in the opt-in no-email mode. Public Supabase signup stays disabled in every mode.

## Deployment after approval

No production migration, account creation, Auth setting change or deployment was performed during implementation.

1. Verify the existing schema-6 setup and owner bootstrap. After database approval, apply only [`202611110002_beta_registration.sql`](../supabase/migrations/202611110002_beta_registration.sql). It adds private registration claims, shared attempt budgets and service-only RPCs. It does not update Auth users, inventory, sales, financials or photos. `select public.verify_thrift_log();` must return schema 7, `betaRegistration: true`, and passing existing beta/security checks.
2. After approving the no-email tradeoff below, set **`BETA_REGISTRATION_MODE=preauthorized`** in the existing Vercel project's intended environment. The default is `disabled`. Preserve the current Supabase variables and `OWNER_EMAIL`. This mode needs no SMTP, invitation template, `BETA_SITE_URL`, global confirmation toggle or public-signup change.
3. Deploy only after approval. Sign in as owner, authorize your friends' exact emails, and send them the app's login URL. They choose **Create Account**. Confirm each sees an empty separate workspace and your original records remain present.

`npm run supabase:verify` checks schema-7 readiness when registration is enabled. It is read-only. Inspect migration history before applying SQL; do not replay existing migrations. Existing sign-in still supports schema 6 while registration is disabled, so enabling the feature can follow migration verification.

## Email ownership and recovery

Supabase's server-only [`auth.admin.createUser`](https://supabase.com/docs/reference/javascript/auth-admin-createuser) creates accounts without sending email. In `preauthorized` mode the app explicitly uses `email_confirm: true` **only after** checking the private tester authorization. This bypasses confirmation for that new account; it does not disable confirmations globally. Private app metadata records that no email proof was obtained. Metadata never grants access or owner rights.

**An approved email is not proof that the person typing it owns that mailbox. Someone who knows an unused approved address could claim it first.** Owner email addresses and existing accounts are protected from this signup path. Rate limiting cannot resolve ownership. Use no-email mode only for a small trusted beta, approve addresses immediately before your friends register, and verify with them out of band. It is not suitable for public registration.

Without working email delivery there is no self-service email password recovery. The owner must verify the tester out of band and reset **that existing Auth UUID** through the trusted Supabase Auth Admin API/local authenticated tooling. The tester then chooses a password at `/set-password`. Never delete/recreate accounts to resolve setup, share the service key, or share the owner's credentials. Registration cannot reset passwords merely because someone types an approved email.

### Existing invited or registered users

- Registered users sign in normally. Create Account with the correct existing password also signs in to the same UUID/workspace. A different password cannot replace it or create another account.
- Pending invitations keep the existing `/auth/confirm` setup path and UUID. Use the original invite link when available. If email is unavailable, the owner verifies the friend out of band and completes that same account through the Auth Admin API using a unique temporary password and confirmed email. The friend signs in and visits `/set-password`. This exception requires owner assistance: registration deliberately cannot take over an existing invited account. No business records are replaced.
- Revoked accounts must first be restored in Beta testers. Signup never restores authorization automatically.

## Enable confirmation later

Set **`BETA_REGISTRATION_MODE=email`** after configuring existing Supabase mail delivery and canonical `BETA_SITE_URL`. Keep public signup disabled and global confirmations enabled. New approved accounts use `email_confirm: false`, link to the approved UUID and remain denied workspace/RLS/photo access until confirmed. The server requests a signup-confirmation email using `auth.resend`; it never exposes confirmation tokens. The callback verifies signup OTPs server-side and rechecks current membership.

In Supabase's **Confirm signup** template, use:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup">Confirm account</a>
```

Allow the exact canonical `/auth/confirm` redirect. Existing invitation/recovery templates continue working. Delivery failures leave accounts unconfirmed and request owner assistance; they never grant access or reset passwords. This uses the [resend API](https://supabase.com/docs/reference/javascript/auth-resend), checked against [Supabase Auth's resend handler](https://github.com/supabase/auth/blob/master/internal/api/resend.go), which handles existing unconfirmed users separately from public signup. Real delivery needs a live check on your hosted Auth version after approved setup.

Switching modes affects **new** accounts. Previously created no-email accounts are not retroactively mailbox-verified. Requiring proof from them needs an explicit owner-managed verification step; changing the mode cannot establish ownership.

## Abuse prevention and isolation

- Same-origin POST only, bounded 4 KB bodies, normalized emails and 8-character minimum passwords (maximum 72 UTF-8 bytes to avoid bcrypt truncation). Existing sign-in rules are unchanged; Supabase also enforces its password policy.
- Shared database budgets: 5 attempts per email, 20 per client and 100 globally per 15 minutes, including denied attempts. HTTP 429 includes `Retry-After`. Keys are HMACs using the server credential; raw IPs are not stored. Vercel's overwritten client-IP header is trusted only on Vercel; other hosts share a conservative bucket. Caller-controlled `X-Forwarded-For` cannot bypass limits. Old counters are cleaned up; no in-memory limiter or extra service is required.
- A two-minute private reservation serializes competing signups. Linking rechecks its token, exact Auth email/UUID, tester role and active authorization. Revocation blocks subsequent access. Uncertain creates recover through password-authenticated sign-in. Registration never updates or deletes existing accounts.
- Existing RLS, tenant foreign keys, live membership checks, financial safeguards, UUID-scoped drafts and authenticated photo delivery remain. Signup cannot authorize emails, grant owner privileges or select another user's workspace.

## Local checks and hosted limits

`tests/registration.test.ts` runs actual migrations and the registration handler against local PostgreSQL/PGlite with explicit Auth service doubles. It covers approved/unknown/revoked emails, separate workspaces, shared IDs, populated Storage denial, owner login, all 18 owner business tables and financial records remaining unchanged, pending invitations, duplicate accounts, passwords, failed linking, claim expiry, rate limits and future confirmation. Existing Auth/API and demo regression tests remain.

`npm run test:registration-browser` renders the real login form with synthetic loopback-only configuration and intercepted API responses at desktop/iPhone sizes. It checks Create Account, input preservation, pending states, errors and confirmation messaging. It does not contact production. Hosted account creation, recovery, email delivery and actual iPhone Safari require an approved live check.

Completed checks: typecheck, lint, production build, 230 unit/database tests (one opt-in live-image test skipped), all 62 existing browser regressions and four new registration browser checks. A populated schema-6 upgrade test compares all 18 business tables, existing owner/verified/invited/revoked Auth accounts (including UUIDs and password hashes), beta authorizations and Storage references before/after migration 7; they remain identical. Mobile screenshots were also inspected. No production writes or deployments were performed.
