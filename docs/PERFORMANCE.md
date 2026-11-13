# Navigation and interaction performance

Thrift Log keeps each authenticated workspace in a shared App Router layout. Switching Home, Inventory, Sales, Activity, Insights and Settings reuses that in-memory snapshot instead of downloading and parsing every business record again. The public demo has a separate layout and browser-only data. No private business-data cache is added to localStorage, IndexedDB or the service worker.

## What became faster

- Workspace and browser-support providers persist between tabs. Whatnot's synchronization controller also mounts once per workspace; its status notice stays in the existing interface. Navigation no longer restarts initial workspace loading or connection-status requests.
- Inventory stage changes use Next's supported native History integration. They update `useSearchParams` and filter already-loaded records immediately, without a server navigation. URL refresh/back behavior and canonical stages are retained.
- Navigation links show a small, fixed-position pending indicator while protected route checks finish. Existing touch targets, focus styles, labels and reduced-motion behavior remain intact.
- A view-local clock replaces the global one-second context update. Idle screens update by minute. Running timers retain second-level updates, stop unnecessary rendering while hidden, and resume from real session timestamps. Paused time remains excluded.
- Views use stable props and memoized snapshots. Financial lists build posting/order/item indexes instead of rebuilding the complete ledger for each price, profit or payout cell. Refunds, fee credits, returns, reversals, payout allocations, unknown costs and incomplete Whatnot fees keep their existing definitions. No posted value, date, cost basis or schema is changed.
- Background workspace checks coalesce. While visible, the app checks the current user's revision about once per minute and on focus, return to visibility and reconnection. An unchanged revision returns an empty `304`; changed data uses the full readiness-checked loader. Explicit Refresh still requests the full snapshot. Refreshes during a save queue behind it, and older responses cannot overwrite a newer confirmed revision. Background checks do not erase save errors.

## Authorization stays live

Private pages and APIs still call verified Supabase `getUser()` and the uncached beta-access check. The cookie proxy uses `getSession()` only to refresh expiring cookies; it ignores the session's user data completely and never authorizes from it. This removes duplicate network verification without treating cookie contents as a trusted identity.

`pageIdentity` uses React's request-scoped `cache` to share a check between the initial server layout and page. It is **not** a cross-request, timed or cross-user authorization cache. Subsequent protected navigation rechecks access. Each API continues to verify authorization independently; RLS, tenant foreign keys, private Storage access, revision checks and atomic commits remain unchanged.

The revision endpoint selects only the verified actor's workspace row. IDs supplied in query parameters never select another account. On account/owner-role mismatch, the client hides the old workspace and reloads against the fresh server identity. Unauthorized responses clear private snapshots and drafts; an already-in-flight response cannot resurrect that cached data. Unmounted readers abort. Business records remain in Supabase.

## Controlled comparison

A local production build used the same loopback Auth service double, one retained inventory record, iPhone-sized Chromium and **150 ms artificial latency per backend request**:

| Per tab switch | Before | After |
| --- | ---: | ---: |
| Backend requests | 12 | 2 |
| Full workspace downloads | 1 | 0 |
| Extra Whatnot status request | 1 | 0 |
| Observed transition work | about 2.1 seconds | about 0.6–1.0 seconds |

That is roughly 83% fewer backend requests and roughly a 50–70% time reduction across controlled runs. These are not measurements from a physical iPhone or a guaranteed production response time. Real device speed, data volume, hosting/network latency and token refresh affect the result. Initial load and saves still wait for authoritative server validation and confirmation.

Regression coverage checks authenticated navigation reuse with fresh authorization, local stage filtering, pending feedback, revision refresh/deduplication, cross-device changes, save failures/retries, delayed responses, account switching, revocation, public-demo separation, idle rendering and timer pause/background/resume accuracy. All provider/database tests use synthetic fixtures and local doubles/PGlite; they do not write production data.

## Deployment

No database migration, Auth setting, Vercel plan change, new dependency or new environment variable is required. Deploy the application code through the existing GitHub → Vercel workflow. Existing workspace data and the separate Whatnot setup/migration requirements are unchanged. The PWA uses the same updated application code; the service worker continues to cache public assets only.
