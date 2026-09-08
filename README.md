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
  cron — `src/lib/cashin.ts` fetches `GET /v1/admin/invoices/payments?start=&end=`
  live on every request for the current month-to-date and for the "pace"
  comparison range (the same day-of-month cutoff last month, e.g. 1–7 September
  compared against 1–7 August — capped to the shorter month where relevant, so
  Mar 31 compares against Feb 28/29). The MTD report (`getCashinReport`)
  additionally fetches each unique invoice's line items (`include=entries`,
  batched at 40 per request per Storeganise's own guidance against larger
  `include` lists) to classify every line into New Rent, Extension, Late Fee,
  Non-rental Item, or Tidak Terklasifikasi (uncategorized) — Storeganise has
  no field for any of these distinctions. The MTD report and the pace
  comparison run concurrently (`Promise.all`, not sequential awaits — an
  earlier version awaited them one after another, which doubled `/api/cashin`'s
  latency for no reason and was the main reason the page needed a manual
  refresh to load). The pace comparison also uses a separate, cheaper
  `getCashinTotalExcludingDeposit` rather than the full report a second time:
  it only ever needs a total, never the New Rent/Extension split, so it skips
  the per-rental invoice-history lookup below entirely — the most expensive
  part of categorization, and unnecessary for a total.
  - **Security deposits are excluded from cash-in entirely**, tracked
    separately as `depositTotal` — a deposit (one month's rent, collected from
    new tenants) is a refundable liability, not revenue, so it's never rolled
    into `totals`/`total` or any of the five categories. Both the MTD and pace
    totals exclude deposits (via `isDepositEntry`, shared by both code paths),
    so the "vs pace" comparison stays apples-to-apples. Detected by matching
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
- `src/auth.ts` configures Auth.js (NextAuth v5) with a Google provider; its
  `signIn` callback rejects any email not ending in `@spacehub.id`.
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

Remember to add the deployed URL's `/api/auth/callback/google` as an
authorized redirect URI in the Google Cloud OAuth client — Google will reject
the login otherwise.

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
