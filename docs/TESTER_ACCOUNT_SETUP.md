# Complete an existing tester account without email

Previously invited testers already have Supabase Auth accounts. Create Account correctly refuses to replace their passwords or create duplicate users. The owner can now issue a private recovery link from Thrift Log; the tester then chooses a password on the existing account.

## What you need to do

After approving and deploying this code:

1. Sign in as the owner at your normal Production app after approved deployment. Open **Settings → Beta testers** (use your avatar on iPhone). Create real links there, rather than on a protected Vercel Preview that your friend cannot open.
2. Find the friend's authorized email and tap **Set up tester account**. Confirm, then tap **Copy private setup link**.
3. Send that link directly to the intended friend using a private channel. The friend opens it, taps **Continue to set password**, enters and confirms a password of at least **8 characters**, and taps **Save password**.
4. Repeat for the second friend. They can subsequently use normal **Sign in**, with the same Auth UUID, inventory and workspace as before.

There is no SMTP, Terminal, temporary password, migration or new environment variable to configure. The link uses the actual app origin where the owner created it, so `BETA_SITE_URL` and Supabase redirect allowlists are not required for this flow. Existing email invitations remain supported separately.

If an email is revoked, restore its authorization first. If there is no existing Auth account, ask that friend to use Create Account instead; this action never creates users. If a link is expired, used or replaced, create a new link for the same email. Never delete/recreate users or re-import their inventory.

## What the action changes

Creating a link uses server-only [`auth.admin.generateLink({type: 'recovery', email})`](https://supabase.com/docs/reference/javascript/auth-admin-generatelink). It creates/rotates a recovery secret for the existing account without sending mail, changing its password or touching business records. Only the tester's explicit redemption/Save password changes their Auth confirmation/session/password state. Existing verified accounts can also use this for owner-assisted password recovery.

**The setup link is a private, one-use credential.** Verify the recipient out of band and share it only with that tester. No password, service key, access/refresh token, provider action URL or email OTP is displayed. The owner sees only a Copy button; the link is held in component memory, not browser storage or server-rendered HTML. Its secret is in a fragment (never an HTTP request URL or referrer), and the setup page removes the fragment from browser history before redemption. It is sent to the server only in a same-origin POST. Do not put real setup links in chat, screenshots, logs or public posts.

Expiry and verification-attempt limits follow the existing Supabase Auth settings. Creating another link replaces the previous recovery secret. The application does not disable verification, weaken RLS, enable signup, change global Auth settings or silently reset an existing password.

Owner authorization is checked using the live verified session, configured owner email and private database role. Only active authorized tester emails are eligible; IDs or redirect targets supplied in request bodies are ignored. The server finds the existing Auth record, protects the owner's identity, checks the provider returned that exact UUID/email, and rechecks authorization before sharing a link. Redemption accepts only a recovery proof, requires a verified active tester, and clears the new session if authorization fails. Owner tokens, revoked accounts, reused tokens and mismatched bound identities cannot open a tester workspace through this flow. Existing server/RLS/Storage isolation remains.

## Validation and rollout limits

The complete loopback browser tests exercise the real Next.js routes, Supabase SDK and HTTP-only cookies against an explicit local Auth service double on desktop and iPhone-sized Chromium: owner issuance/copy, private fragment handling, confirmation, password choice, reload/sign-in, same UUID and retained inventory, forbidden owner/tester APIs, cross-account photo denial, replay and revocation. Separate PostgreSQL/PGlite integration tests exercise the actual RLS/RPCs and compare existing business records and financials through setup.

Provider behavior was checked against Supabase Auth's [recovery-link generation](https://github.com/supabase/auth/blob/master/internal/api/mail.go) and [recovery verification](https://github.com/supabase/auth/blob/master/internal/api/verify.go): recovery targets an existing user and can confirm an uncompleted invitation while preserving its UUID. Hosted account setup and actual iPhone Safari still require an approved live check.

No production accounts, passwords, data, Supabase settings or schema were modified while preparing this feature. Deployment is separate from account setup: do not generate real links or redeem them until the owner approves those account operations.

Completed checks: typecheck, lint, production build, 244 unit/database tests (one opt-in live-image test skipped), all 62 existing browser regressions, four registration browser checks and four full tester-setup browser checks. The 70 browser checks cover desktop and iPhone-sized Chromium; hosted account operations and actual iPhone Safari are not claimed as verified.
