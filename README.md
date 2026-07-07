# Workshop Hub

Booking, stock/reorder, job-type recipes, profit-per-job, and workshop job cards
(with dictation, video evidence log, and signature sign-off), backed by Supabase
so Office and Workshop devices see the same data instantly.

## First-time setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is enough).
2. **Run the schema**: open the Supabase dashboard → SQL Editor → New query, paste in
   [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates the tables,
   turns on realtime, sets row-level security, and seeds the same starter data as the
   original prototype (parts, job types, recipes).
3. **Copy the environment file**:
   ```
   cp .env.example .env.local
   ```
   Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase
     Project Settings → API.
   - `SITE_PASSWORD` — the one password Office and Workshop staff will use to get in.
   - `AUTH_SECRET` — any random string, e.g. `openssl rand -hex 32`.
4. **Install dependencies and run it locally**:
   ```
   npm install
   npm run dev
   ```
   Visit `http://localhost:3000`, enter the password, and it should look and behave
   exactly like the original prototype.

## Deploying

1. Push this folder to a GitHub repo.
2. Import the repo in [Vercel](https://vercel.com/new) — it auto-detects Next.js.
3. Add the same four environment variables from `.env.local` in the Vercel project's
   Settings → Environment Variables.
4. Deploy. Every push to the repo redeploys automatically.
5. On the workshop iPad, open the deployed URL in Safari and use **Share → Add to
   Home Screen** — it installs standalone (its own icon, no browser chrome), because
   of the PWA manifest and Apple web-app metadata already wired up in `app/`.
6. Optional: point a subdomain (e.g. `workshop.thetimingchainspecialists.co.uk`) at
   the Vercel deployment from your DNS provider, then add it under the Vercel
   project's Domains tab.

## What's different from the in-chat prototype

- **Storage**: `window.storage.get/set` calls are now real Supabase queries — see
  [`lib/data.js`](./lib/data.js) for the full read/write layer and the camelCase
  (app) ↔ snake_case (database) mapping.
- **Real-time sync**: Supabase realtime subscriptions (also in `lib/data.js`) mean
  a booking made in Office mode shows up in Workshop mode on another device without
  a manual refresh.
- **Login**: a single shared password gates the whole app (`proxy.js` +
  `app/login`) — nothing here is publicly reachable without it.
- **PWA**: `app/manifest.js`, `app/icon.js`, and `app/apple-icon.js` generate the
  icons and manifest needed for "Add to Home Screen" to open standalone.

Dictation and the signature pad are plain browser APIs (`SpeechRecognition`,
`<canvas>`) — unaffected by any of the above, exactly as they worked in the prototype.

## Project notes

- Built on **Next.js 16** (App Router). It renamed `middleware` to `proxy` and made
  a few other breaking changes from what you might expect of "Next.js" in general —
  see `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` if you
  ever need the specifics.
- The database has six tables, not five: the deployment spec's five (`parts`,
  `job_types`, `job_type_parts`, `bookings`, `job_cards`) plus a `settings` table
  (workshop postcode, VAT flag, transport companies) that the app needs but wasn't
  in the original table list.
