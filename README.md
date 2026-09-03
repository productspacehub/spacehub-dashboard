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
  overall rate plus a per-site breakdown.
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

Remember to add the deployed URL's `/api/auth/callback/google` as an
authorized redirect URI in the Google Cloud OAuth client — Google will reject
the login otherwise.

## Known assumption to verify

The Storeganise docs available while building this didn't show a sample
response body for the list endpoints, so `fetchSites`/`fetchUnits` in
`src/lib/storeganise.ts` accept either a bare JSON array or a wrapped
`{ data: [...] }` / `{ results: [...] }` / `{ items: [...] }` object. Confirmed
against a real response to be a bare array; the wrapped-object fallback in
`extractList` can be removed once that's certain to always hold.
