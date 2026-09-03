# Spacehub Occupancy Dashboard

Real-time unit occupancy rate for Spacehub, pulled from the Storeganise Admin API.

## Setup

1. In the Storeganise admin app, go to **Settings > Developer** and create an API key
   (requires the `manager` role).
2. Copy `.env.example` to `.env.local` and set `STOREGANISE_API_KEY` to that key.
3. Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

## How it works

- `src/lib/storeganise.ts` calls the Storeganise Admin API (`GET /v1/admin/sites`
  and `GET /v1/admin/units`, paginated) and computes occupancy per site and
  overall. A unit counts as part of a site's capacity unless its state is
  `archived`; `occupied` units divided by that capacity is the occupancy rate.
- `src/app/api/occupancy/route.ts` exposes that computation as a server-side API
  route, so the Storeganise API key never reaches the browser.
- `src/app/page.tsx` polls `/api/occupancy` every 60 seconds and renders the
  overall rate plus a per-site breakdown.

## Deploying

Deploy to Vercel and set `STOREGANISE_API_KEY` (and optionally
`STOREGANISE_BASE_URL`) as an environment variable in the project settings —
never commit it to the repo.

## Known assumption to verify

The Storeganise docs available while building this didn't show a sample
response body for the list endpoints, so `fetchSites`/`fetchUnits` in
`src/lib/storeganise.ts` accept either a bare JSON array or a wrapped
`{ data: [...] }` / `{ results: [...] }` / `{ items: [...] }` object. Confirm
against a real API response and simplify `extractList` once the actual shape
is known.
