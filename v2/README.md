# FishCast v2 — Vue 3 rebuild

Vue 3 + Vite + TypeScript + Pinia + Vue Router, with Supabase auth and
cross-device setup sync. The v1 vanilla-JS app at the repo root stays
untouched and deployable.

## Run locally

```bash
cd v2
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # vue-tsc
npm run build      # production build to dist/
```

## Enable accounts (Supabase)

Without configuration the app runs in **local-only mode** (everything in
localStorage, no login button shown as functional). To enable signup/login:

1. Create a free project at https://supabase.com
2. Run `supabase/schema.sql` in the SQL editor (creates the `setups` table
   with row-level security so users only see their own data)
3. Copy `.env.example` to `.env` and fill in the project URL + anon key
   from Settings → API
4. Restart `npm run dev`

Email confirmation is on by default in Supabase — after signup the user
confirms via email, then logs in. The setup (locations, target species,
time slots, language) syncs automatically: saved locally on every change
and pushed to Supabase debounced; pulled on login.

## Structure

```
src/
  lib/        i18n (ported strings), species data, solunar, scoring, weather API
  stores/     Pinia: auth (Supabase session), setup (sync), forecast (cache)
  views/      Welcome, Auth, Availability, Locations, Species, Dashboard
  router/     hash-based routes + dashboard guard
```

## Ported from v1

- Full DA/EN string table, species data (names/tips/warnings), solunar engine
- Scoring core: pressure trend, solunar periods, time-of-day, wind, waves
  (incl. the inland `waveM:null` fix), moon phase, species bonuses, dedup

Not yet ported: map view, spot finder wizard, tides/lightning (DMI),
lure recommendations, notifications, PWA/service worker.
