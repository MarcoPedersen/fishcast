# FishCast — Vue 3 app

Vue 3 + Vite + TypeScript + Pinia + Vue Router, with Supabase auth and
cross-device sync. A PWA: installable, works offline against cached data.

Live at <https://marcopedersen.github.io/fishcast/v2/> (the repo root
redirects here). The original vanilla-JS v1 app has been retired — it lives
only in git history now.

## Run locally

```bash
cd v2
npm install
npm run dev        # http://localhost:5173/fishcast/v2/
npm test           # vitest (unit tests)
npm run typecheck  # vue-tsc
npm run build      # production build to dist/ (runs typecheck first)
```

## Enable accounts (Supabase)

Without configuration the app runs in **local-only mode** — everything in
localStorage, no sync. To enable signup/login:

1. Create a free project at <https://supabase.com>
2. Run `supabase/schema.sql` in the SQL editor. It creates the `setups` and
   `catches` tables with row-level security so users only see their own rows.
3. Copy `.env.example` to `.env` and fill in the project URL + anon key
   (Settings → API). The anon/publishable key is safe in a frontend bundle;
   never ship the service_role key.
4. Set **Authentication → URL Configuration** → Site URL and Redirect URLs to
   the deployed app URL, or password-reset links will point at localhost.
5. Restart `npm run dev`

Supabase's built-in mailer is heavily rate-limited; configure custom SMTP for
real signups.

### Sync model

Local-first, merged three-way. Every edit saves to localStorage immediately
and pushes to Supabase debounced (1.5s). Each store (setup, catch log) keeps
the row version it last agreed on with the account — its `updated_at` and a
copy of the document as of then, the base — and every push is conditional on
it (`lib/syncRow.ts`): when another device has written since, nothing is
touched; the store reads the row, merges base, local and remote
(`lib/merge.ts`), and pushes the result. The merge keeps an item added on
either side, lets an edit beat a stale delete, and takes each field from the
side that changed it (local when both did). What a pull does — adopt, push,
merge — is `lib/sync.ts`. A document from before the base existed is unioned
with the row, so nothing is dropped; only there does a clock break a tie
(where both hold a field, the newer edit stamp wins, as that version decided).
Signing out clears local state so the next user on the device can't inherit
or overwrite it.

Known limit: a push that landed but whose answer was lost is recognised as
the device's own write only if that device reads the row before another
device writes on top of it. Otherwise the merge takes that write for the
other device's changes: an item it added and that was deleted since can come
back, and the other device's edit to it can be reverted. Nothing is lost
(see `SentWrite` in `lib/syncRow.ts`).

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the tests,
builds, and publishes to GitHub Pages. A failing test blocks the deploy.
Requires repo secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Structure

```
src/
  lib/        scoring engine + SCORE_WEIGHTS, weather/DMI APIs, solunar,
              species & regulations data, spot finder, i18n strings (da/en),
              calendar (.ics) export, sync reconciliation, catch scoring
  stores/     Pinia: auth (Supabase session), setup, catches, forecast (cache)
  views/      Welcome, Auth, Availability, Locations, Map, SpotFinder,
              Species, Dashboard, CatchLog
  components/ Toasts, ConfirmDialog, MoonCard, SeasonsTab, ConditionsTab
  router/     hash-based routes + dashboard guard
docs/         push-notifications.md (setup recipe for real Web Push)
```

## Features

- **Dashboard** — scored time windows, 7-day trend sparklines (tap a bar for
  that day's breakdown), Simple/Full density toggle, week-at-a-glance strip,
  top pick, forecast-confidence markers
- **Score breakdown** — every factor's contribution, summing exactly to the
  displayed score, with a plain-language explanation of each
- **Spot finder** — "lucky" (best in Denmark) and "nearby" modes. NB: the
  finder score rates *spot suitability* (weather-independent); the dashboard
  score rates *live conditions*. They intentionally differ.
- **Map** — add custom spots; saved pins are coloured by today's score
- **Catch log** — species, date/time, quantity, size/weight (both optional),
  kept/released, method, notes. Regulation guards flag undersized (unless
  released) and closed-season catches. "Model check" backtests the scoring
  engine against your actual catches.
- **Other** — DA/EN, calendar export, share links, reminders, PWA/offline

## Scoring

`lib/scoring.ts` is pure and unit-tested. All point values live in one
`SCORE_WEIGHTS` table — tune the model there. The window score is the sum of
each factor's contribution averaged across the window's hours, which is why the
breakdown modal always adds up.

Availability hours are **local wall-clock** times, anchored in local time before
matching forecast hours. The app assumes the user's clock is Danish local time.

## Caveats

- Regulations are guidance only — always verify on lfst.dk before fishing.
- Reminders use `setTimeout`, so they only fire while a tab is open. Real Web
  Push needs a server; see `docs/push-notifications.md`.
- `lib/regulations.ts` and `lib/solunar.ts` are `@ts-nocheck` ports from v1.
