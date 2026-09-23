# Spacehub Occupancy Dashboard

Real-time unit occupancy rate for Spacehub, pulled from the Storeganise Admin API.
Access is gated behind Google login, restricted to `@spacehub.id` accounts.

## Setup

1. In the Storeganise admin app, go to **Settings > Developer** and create an API key
   (requires the `manager` role).
2. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an OAuth client ID (**APIs & Services > Credentials > Create Credentials
   > OAuth client ID**, application type **Web application**). Set the authorized
   redirect URI to `<your-deployed-url>/api/auth/callback/google` (and
   `http://localhost:3000/api/auth/callback/google` for local dev).
3. Copy `.env.example` to `.env.local` and fill in `STOREGANISE_API_KEY`,
   `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_SECRET` (generate the last
   one with `npx auth secret`).
4. Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to
`/login` until you sign in with a `@spacehub.id` Google account.

## How it works

- `src/lib/storeganise.ts` calls the Storeganise Admin API (`GET /api/v1/admin/sites`
  and `GET /api/v1/admin/units`, paginated) and computes occupancy per site and
  overall. A unit counts as part of a site's capacity unless its state is
  `archived`; `occupied` units divided by that capacity is the occupancy rate.
- `src/app/api/occupancy/route.ts` exposes that computation as a server-side API
  route, so the Storeganise API key never reaches the browser.
- `src/app/page.tsx` polls `/api/occupancy` every 60 seconds and renders the
  overall rate plus a per-site breakdown, linking to `/occupancy` for detail.
- `getUnitsDetail` in `src/lib/storeganise.ts` additionally fetches
  `GET /api/v1/admin/unit-rentals?state=occupied&include=owner` to resolve a
  customer's email for each occupied unit (joined by `unitId`), and reads
  `blockedReason` directly off blocked units. `src/app/api/occupancy/units/route.ts`
  exposes this as a status breakdown (percentages exclude archived units from
  the total) plus a flat per-unit list; `src/app/occupancy/page.tsx` renders it
  with status tabs (Available/Occupied/Reserved/Blocked — Archived has no tab
  since there's nothing actionable to do with an archived unit, though its
  count still shows in the breakdown summary). The breakdown itself is one
  100%-stacked bar (not four separate meters) so the whole unit pool's
  composition reads at a glance, colored by reusing existing status tokens
  (available=status-good, occupied=series-1, reserved=status-warning,
  blocked=status-critical) with a legend underneath. Below that, a site
  filter and a table
  whose columns adapt to the selected status: customer email + latest invoice
  for Occupied, blocked reason for Blocked, and customer name + phone + email
  for Reserved (so sales can follow up on payment before move-in).
- The Available tab shows Floor, Unit type, Size, and Price/month — so sales
  can quote a potential customer without opening Storeganise separately. Floor
  and the raw size (`length`/`width`/`height`/`measure`) come straight off the
  Unit object; Unit type name and price need a separate
  `GET /v1/admin/unit-types` fetch (`fetchUnitTypes`), joined by `typeId`. Two
  caveats worth knowing: (1) this endpoint's response shape wasn't in the docs
  available while building this — only the field names used elsewhere in the
  API were available as a guide (an `id` + Sites-style `title` map) — so it
  fails soft (`.catch(() => [])`) rather than breaking the whole Available tab
  if the shape turns out to be different in practice; (2) price prefers the
  unit's own `defaultPrice`, falling back to the unit type's price only when
  the unit doesn't have its own — matching Storeganise's own documented
  behavior ("a move-in job that doesn't specify a unit price uses the type's
  price"), but this fallback hasn't been checked against a real unit that
  actually needs it.
- Reserved units resolve owner contact info the same way as Occupied ones —
  `fetchRentalsWithOwner` is called for both `state=occupied` and
  `state=reserved` against `GET /v1/admin/unit-rentals?include=owner`. The
  Reserved tab also shows when the reservation was made, from that same
  rental's `created` field.
- The latest invoice (number, state, paid date) shown on the Occupied tab
  comes from `GET /api/v1/admin/invoices?start=<60 days ago>`, grouped
  client-side by `unitRentalId` and matched back to units via the same
  occupied-rentals fetch used for owner email. Invoices only support
  filtering by a single `unitRentalId` per request, so fetching one per
  occupied unit wouldn't scale — a 60-day window comfortably covers the
  latest invoice for any actively-occupied unit given they're billed
  monthly; a unit with nothing in that window simply shows no invoice.
  The invoice "number" customers see is the `sid` field, not `id`.
- The Blocked tab shows how long a unit has been blocked ("blockedDuration",
  formatted as e.g. "1 Tahun 3 Bulan 5 Hari" — zero-valued units are omitted
  wherever they fall, not just when leading, so 6 months exactly reads as
  "6 Bulan" rather than "6 Bulan 0 Hari", and a same-day block reads as
  "0 Hari"). There's no `blockedAt` field on
  the Unit itself — the timestamp comes from that unit's action history,
  `GET /v1/admin/units/:unitId/actions`, finding the most recent entry with
  `type: "unit.block"` (actions come back newest-first). This is a separate
  API call per currently-blocked unit since that endpoint has no bulk/
  multi-unit form — acceptable since blocked units are a small subset of the
  total. `formatDurationSince` walks forward year-by-year then month-by-month
  with native Date arithmetic rather than subtracting date components
  directly, to avoid a negative-day-count bug that a naive approach hits for
  start dates near month-end (e.g. Jan 31 to Mar 1). Some blocked units may
  have no `unit.block` entry in their history (blocked before this action log
  existed, or via a path that doesn't log it) — those just show no duration.
- **Historical comparison** ("+2 units vs yesterday", the trend chart). Storeganise's
  API only reflects current state — there's no history endpoint — so
  `/api/cron/snapshot` runs once daily (`vercel.json`, 17:00 UTC = 00:00 WIB) and
  writes one row per site to a Postgres `occupancy_snapshots` table (`src/lib/db.ts`,
  `src/lib/snapshots.ts`), guarded by a `CRON_SECRET` check since it's excluded
  from the login-required proxy matcher (Vercel Cron has no session). Both
  `/api/occupancy` and `/api/occupancy/units` then compare today's live
  Storeganise numbers against a stored snapshot — `?compareTo=yesterday|7d|30d|
  YYYY-MM-DD` on the units endpoint — and degrade to `delta: null` /
  `available: false` rather than failing the page if the database or a given
  date's snapshot isn't there yet (most relevantly: right after this feature
  first ships, before the cron has run even once). `getTrend` aggregates the
  last 30 days of occupied-unit counts for the sparkline. Dates are labeled by
  Jakarta calendar day throughout, computed via `toLocaleDateString("en-CA",
  { timeZone: "Asia/Jakarta" })` rather than UTC, and read back from Postgres
  with an explicit `to_char(..., 'YYYY-MM-DD')` cast — a bare `date` column
  otherwise comes back through `pg` as a JS `Date` at UTC midnight, which can
  print as the wrong day once serialized and re-parsed in a non-UTC timezone.
- **Cash-in** (`/cash-in`, plus a summary card on the home page). Unlike occupancy,
  Storeganise retains full payment history, so this needs no snapshot table or
  cron — any month, past or present, can be recomputed on demand the same way.
  `/cash-in` has a period selector (Bulan ini / Bulan lalu / Bulan lain) so a
  closed month's final numbers stay reachable at any time, not just in the
  first few days of the next month before "month to date" resets to almost
  nothing. `GET /api/cashin?period=` accepts `current` (default, month-to-date
  capped at today), `last` (the previous full calendar month), or a literal
  `YYYY-MM` for any other month (a future month clamps to the current one).
  The response's `isCurrentMonth` flag tells the UI which wording to use: for
  the live month, the comparison is "pace" — the same day-of-month cutoff last
  month (e.g. 1–7 September vs 1–7 August, capped to the shorter month where
  relevant so Mar 31 compares against Feb 28/29) — since that's the only fair
  comparison for a partial month; for a closed month, it's simply the full
  month before it, plain "vs Juli" with no "pace" wording. `src/lib/cashin.ts`
  fetches `GET /v1/admin/invoices/payments?start=&end=` for whichever range is
  requested. The main report (`getCashinReport`) additionally fetches each
  unique invoice's line items (`include=entries`, batched at 40 per request
  per Storeganise's own guidance against larger `include` lists) to classify
  every line into New Rent, Extension, Late Fee, Non-rental Item, or Tidak
  Terklasifikasi (uncategorized) — Storeganise has no field for any of these
  distinctions. The main report and the comparison figure run concurrently
  (`Promise.all`, not sequential awaits — an earlier version awaited them one
  after another, which doubled `/api/cashin`'s latency for no reason and was
  the main reason the page needed a manual refresh to load). The comparison
  also uses a separate, cheaper `getCashinTotalExcludingDeposit` rather than
  the full report a second time: it only ever needs a total, never the New
  Rent/Extension split, so it skips the per-rental invoice-history lookup
  below entirely — the most expensive part of categorization, and unnecessary
  for a total.
  - **Security deposits are excluded from cash-in entirely**, tracked
    separately as `depositTotal` — a deposit (one month's rent, collected from
    new tenants) is a refundable liability, not revenue, so it's never rolled
    into `totals`/`total` or any of the five categories. Both the requested
    period and its comparison exclude deposits (via `isDepositEntry`, shared
    by both code paths), so the comparison stays apples-to-apples regardless
    of which period is selected. Detected by matching
    "deposit" in the entry's free-text `desc` — Storeganise documents a
    structured `type: "deposit"` value, but real invoices don't actually use
    it (a real deposit line came through as an ordinary `type: "revenue"`
    entry with `desc: "Deposit"`), so the desc check is the one that matters
    and the type check is just a defensive extra.
  - **New Rent vs Extension**: inferred from invoice history, not any field —
    a unit-rental's first-ever invoice is its New Rent, every later invoice for
    that same rental is an Extension. This means one extra request per unique
    rental referenced in the period (`?unitRentalId=`, no bulk filter exists),
    parallelized the same way blocked-unit durations are elsewhere in this file.
  - **Late Fee / Non-rental Item**: keyword-matched against each entry's
    free-text `desc` (case-insensitive — real samples show "Padlock" and
    "padlock" from different staff), since Storeganise entries only carry a
    generic `type` (`deposit`/`prepayment`/`revenue`) with no category of their
    own. Anything matching no known pattern is "Tidak Terklasifikasi" rather
    than being guessed into the nearest category, so an unrecognized
    description never silently misreports.
  - Every classified line item is returned in `entries` (invoice sid, site,
    category, desc, amount, date) — not just the unclassified ones — so any
    number on `/cash-in` can be traced back to real invoices. The page's "Cari
    transaksi" section filters this list by category and site, so e.g. every
    New Rent transaction at a given site can be found and looked up in
    Storeganise directly, the same way as auditing the uncategorized bucket.
  - A single payment can span multiple categories at once (a real example: one
    payment settling a rent period, a prepay-ahead period, and two late fees
    together) — so the split happens at the line-item level, then each
    payment's amount is allocated across categories in proportion to that
    invoice's own entry composition.
  - Above 400 distinct invoices in the requested period, categorization is
    skipped (the total stays accurate; the breakdown reports everything as
    uncategorized with a `skippedCategorization` flag) rather than risk a slow
    request — this hasn't been exercised against real transaction volume yet.
- `src/lib/moveActivity.ts` / `/api/move-activity` / `/move-activity` power the
  Move Activity module — daily Move In, Move Out, and Extend (renewal) counts
  per site, with the same "Bulan ini / Bulan lalu / Bulan lain" period selector
  as Cash-in (Storeganise keeps full rental/invoice history, so no snapshot DB
  is needed here either).
  - **Move In**: unit rentals whose `startDate` falls in the period, via
    `GET /v1/admin/unit-rentals?start=<from>,<to>` — excluding `submitted`,
    `cancelled`, and `abandoned` states (a rental that never actually
    proceeded to occupancy), everything else counts as a real move-in.
  - **Move Out**: unit rentals with `state=ended` and an `endDate` in the
    period, via `GET /v1/admin/unit-rentals?state=ended&end=<from>,<to>` — read
    directly from Storeganise's own structured field. This replaces an earlier
    manual approach (Move In count minus the day's occupancy change), which is
    fragile to same-day move-out+move-in pairs (net occupancy unchanged, but
    one of each happened) and to occupancy snapshots only being taken once a
    day. **Not yet validated against real production volume** — the
    methodology note on `/move-activity` flags this; compare against manual
    counts for a few weeks before fully trusting it over the old approach.
  - **Extend**: invoices paid in the period that are *not* the rental's
    first-ever invoice — the exact same "first invoice per rental" resolution
    Cash-in uses for its New Rent vs Extension split (`resolveFirstInvoicePerRental`,
    exported from `src/lib/cashin.ts` and reused here), just counted per
    invoice instead of summed as revenue. Since `payment.invoice` already
    carries `unitRentalId`, this needs no separate invoice/entries fetch —
    only `fetchPayments`, also reused from Cash-in. Same 400-unique-invoice
    cap as Cash-in (`MAX_INVOICES_TO_CATEGORIZE`, also exported) — above it,
    Extend is skipped for the period (`skippedExtendCategorization`) rather
    than risk a slow request; Move In/Move Out are unaffected since they don't
    depend on this lookup.
  - The daily chart stacks Move In and Extend above a zero baseline (two
    colors, one stack) with Move Out as a separate bar below it — mirroring
    the team's existing weekly "Activation vs Churn" report, just re-colored
    per category and without that report's trendlines.
- **Bookings** (`/bookings`) — the SpaceHub Centralized Booking System MVP.
  Deliberately kept separate from the dashboard above, including off the
  home page: it's a different tool for a different purpose (admin-driven
  booking management), not one more occupancy/cash-in-style metric — reached
  by going to `/bookings` directly, not linked from `/`. Unlike the modules
  above, it isn't read from Storeganise at all: it's this app's own
  Postgres-backed system of record (`src/lib/bookings.ts`, schema in
  `src/lib/db.ts`'s `ensureSchema`), since shared storage/co-working/
  meeting-room/studio bookings are a separate business line with no
  Storeganise equivalent. The data model is intentionally module-agnostic (a
  `module_type` column on the shared tables — `shared_storage` and
  `co_working` are active; `meeting_room`/`studio` are reserved) so each new
  module only adds config (`MODULE_CONFIG` in `src/lib/bookingConstants.ts`),
  never a schema rework. `/bookings` (Shared Storage) and
  `/bookings/coworking` (Co-working) are separate list/create pages — their
  meaningful fields differ too much to share one table (Container vs.
  Addons) — switchable via the tab row at the top of either
  (`ModuleTabs`), but `/bookings/[id]` is one shared, adaptive detail page:
  it renders a Container section or an Addons section depending on the
  loaded booking's own `moduleType`.
  - **Customer** (`customers` table) is shared across all modules by design —
    one record reused everywhere, searchable by phone or name
    (`GET /api/customers?q=`), with inline creation from the booking form.
  - **Booking** (`bookings` table) is the core object: customer, package
    type, dates, price, source (Online Inquiry / Walk-in), payment status,
    and status. Status is one of Pending Payment → Confirmed → Active →
    Completed, with Cancelled/No-Show exits — all manual/admin-driven in the
    MVP, no automatic transitions based on dates. `updateBooking` enforces
    invariants directly rather than leaving them to the UI, and the exact
    behavior is module-config-driven (`MODULE_CONFIG`): flipping payment to
    Paid while a booking is still Pending Payment auto-advances it —  for
    Shared Storage, to Confirmed (`requiresContainer: true`, still needs a
    container assigned at drop-off); for Co-working, straight to Active
    (`autoActivateOnPayment: true` — availability is a headcount check, so
    there's nothing else to wait for). Moving to Active for a module with
    `requiresContainer` additionally requires a Free container in the same
    request.
  - A booking still Active past its own end date is flagged `isOverdue`
    (computed at read time from `status`/`end_date` vs. today's Jakarta
    calendar day, not stored — same reasoning as Container status below: it
    can never drift out of sync, and "today" advances on its own with no
    scheduled job needed). Shown as a red "Overdue" badge on the list and a
    warning banner with days-overdue on the detail page.
  - **Container** (`containers` table) is the physical shared-storage box —
    used only by modules with `requiresContainer: true` (Shared Storage
    today). Its Free/Assigned status is *derived*, not stored — computed as
    "Assigned iff some booking with status = Active currently references
    it" (a `LEFT JOIN` in `listContainers`/`getFreeContainers`). This keeps
    container state always consistent with booking state with no second
    place to update when a booking's status changes, and makes "prevent
    assigning a container already Assigned elsewhere" a simple existence
    check rather than a lock. `/bookings/containers` is the lookup screen —
    search by Container ID, see which customer/booking currently holds it,
    add new containers one at a time (no bulk import in the MVP; admins add
    them as needed).
  - **Rate/Package Config** (`rate_packages` table) is an admin-editable
    price list per module (e.g. Daily/Weekly for Shared Storage; Hot Desk
    Daily/Weekly/Monthly for Co-working) rather than hardcoded pricing,
    since real numbers weren't finalized when this shipped. `PUT /api/rates`
    (`?module=`) replaces the whole list for that module in one call (upsert
    what's present, delete what's dropped) — simple enough for a handful of
    rows an admin edits together, at `/bookings/rates` and
    `/bookings/coworking/rates`. Ships with no rows; a booking's package can
    still be entered manually if the rate table is empty. Selecting a
    package on a booking's create form pre-fills price from this table, but
    price stays editable per-booking (manual overrides/discounts, per the
    spec).
  - **Addons** (`addons` table, admin-editable at `/bookings/addons` and
    `/bookings/coworking/addons` — Padlock for Shared Storage; free water
    refill/TV/lockers for Co-working) follow the same "ships empty, replace
    the whole list" pattern as rate packages (`PUT /api/addons?module=`),
    and are available to every module — the spec's "not used by Shared
    Storage in MVP" note turned out to not hold once a real Shared Storage
    addon (Padlock) came up, and nothing about the schema was
    module-specific to begin with. A booking's selected addons
    (`booking_addons` table, with a `quantity` per line — e.g. 3 padlocks
    on one booking) are stored as a name+price *snapshot* at selection time
    rather than a foreign key — renaming, repricing, or removing an addon
    from the admin menu later never changes what an already-made booking
    shows. The booking form and detail page show Harga (the base package
    price, still independently editable for per-booking discounts) and
    Addon as clearly separate fields/sections, then a computed, read-only
    Total (Harga + Σ addon price × quantity) — never stored, recalculated
    from current form state every render, so it can't drift out of sync
    with whatever's actually selected.
  - Payment is manual in the MVP: admin generates a payment link outside the
    system (e.g. via Xendit) and records it as free text
    (`payment_reference`) against the booking; there's no auto-generation or
    webhook reconciliation. Direct Xendit API integration is a deliberately
    deferred Phase 2 enhancement, not required to launch.
  - Co-working's "headcount check" availability (§7.1) is informational
    only in the MVP — `getActiveHeadcountToday`/`GET /api/bookings/headcount`
    counts today's Active bookings for a module (shown on
    `/bookings/coworking`) but never blocks creating another booking, even
    past that number. No capacity limit is configured or enforced.
  - Out of scope for this MVP (see the spec's non-goals): customer
    self-service booking (admin creates every booking), deposits/holds,
    unit-level placement tracking (which physical unit a container sits in
    stays a manual, offline staff process), reporting/analytics dashboards,
    automated WhatsApp notifications, and role-based permissions (single
    all-access admin role, reusing this app's existing `@spacehub.id` login —
    no separate auth for this module).
- `src/auth.ts` configures Auth.js (NextAuth v5) with a Google provider; its
  `signIn` callback rejects any email not ending in `@spacehub.id`, with one
  deliberate carve-out: exact emails listed in the `EXTRA_ALLOWED_EMAILS` env
  var (comma-separated) are let in too — for external stakeholders who need
  dashboard access without a spacehub.id account, without opening the domain
  rule up generally. Google OAuth itself doesn't need any reconfiguration for
  this — a Gmail account authenticates with Google just fine; the domain
  check is purely this app's own callback.
- `src/proxy.ts` (Next.js's proxy/middleware convention) requires a valid
  session for every route except `/login` and the auth API routes — an
  unauthenticated request to a page redirects to `/login`, and to an API
  route gets a `401` JSON response instead of the app's data.

## Deploying

Deploy to Vercel and set these environment variables in the project settings
(never commit real values to the repo):

- `STOREGANISE_API_KEY` (and optionally `STOREGANISE_BASE_URL`)
- `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- `DATABASE_URL` — auto-added when you connect a Postgres storage (Neon) to
  the project under Settings > Storage; no manual setup needed
- `CRON_SECRET` — generate with `openssl rand -base64 33`
- `EXTRA_ALLOWED_EMAILS` (optional) — comma-separated exact emails to let in
  besides `@spacehub.id`, e.g. an external stakeholder's personal Gmail

Remember to add the deployed URL's `/api/auth/callback/google` as an
authorized redirect URI in the Google Cloud OAuth client — Google will reject
the login otherwise.

### Staging the Bookings module separately from Production

The Bookings module (`/bookings`) uses the same Postgres connection as every
other module here, so testing it against the live Production database would
mix test bookings into real occupancy/cash-in data. This project connects a
second Neon database, `spacehub-booking-staging`, for that:

1. Don't merge a Bookings-module branch into `main` until it's verified —
   Vercel's Git integration deploys every other branch as a **Preview
   Deployment**, with its own URL, separate from Production.
2. The `spacehub-booking-staging` Neon database is connected to this project
   with the custom env var prefix `BOOKING_STAGING`, scoped to the
   **Preview** environment only — so it generates `BOOKING_STAGING_DATABASE_URL`
   (among others) without touching the original `DATABASE_URL`, which stays
   scoped to Production and Preview from the original `spacehub-db`
   connection. `getPool()` in `src/lib/db.ts` prefers
   `BOOKING_STAGING_DATABASE_URL` when it's set, falling back to
   `DATABASE_URL` otherwise — so Preview deployments automatically use the
   staging database, Production is untouched, and no environment-variable
   name ever collides.
3. Once verified on the preview URL, merge to `main` as usual — Production
   only ever sees `DATABASE_URL`, so nothing about the staging database
   affects it.

Historical comparisons only go back as far as the cron has been running —
"vs yesterday" won't show a value until the day after this feature is live,
and "30 hari lalu" needs a month of accumulated snapshots.

## Known assumption to verify

The Storeganise docs available while building this didn't show a sample
response body for the list endpoints, so `fetchSites`/`fetchUnits` in
`src/lib/storeganise.ts` accept either a bare JSON array or a wrapped
`{ data: [...] }` / `{ results: [...] }` / `{ items: [...] }` object. Confirmed
against a real response to be a bare array; the wrapped-object fallback in
`extractList` can be removed once that's certain to always hold.

Move Activity's Move Out figure (`state=ended` + `endDate` range on
`/v1/admin/unit-rentals`) is based on reading Storeganise's documented API
schema, not a test against real production data — this environment had no
live Storeganise credentials to verify it against. Cross-check it against
manual counts for a few weeks after this ships before treating it as
authoritative over the team's existing (delta-based) tracking.
