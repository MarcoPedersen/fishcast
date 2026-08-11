# 🎣 FishCast

A fishing planner for Danish waters. It scores your saved spots and time windows
against live conditions — air pressure trend, wind, waves, tides, solunar
periods, moon phase and time of day — so you can see when and where the fishing
looks best, and why.

**Live:** <https://marcopedersen.github.io/fishcast/v2/>

## Repo layout

```
v2/          the app (Vue 3 + TypeScript + Vite, PWA) — see v2/README.md
index.html   redirect from /fishcast/ to /fishcast/v2/
.github/     CI: test + build + deploy to GitHub Pages
```

The original vanilla-JS implementation (v1) served at `/fishcast/` has been
retired; it remains in git history.

## Quick start

```bash
cd v2 && npm install && npm run dev
```

Full setup — including Supabase for accounts and cross-device sync — is
documented in **[v2/README.md](v2/README.md)**.

## Data sources

- [Open-Meteo](https://open-meteo.com) — weather and marine forecasts
- [DMI Open Data](https://opendatadocs.dmi.govcloud.dk) — tides and lightning
- [OpenStreetMap](https://www.openstreetmap.org) / Nominatim — map tiles and geocoding

Fishing regulations in the app are **guidance only** — always verify on
[lfst.dk](https://lfst.dk) before fishing.
