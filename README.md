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
- [OpenStreetMap](https://www.openstreetmap.org/copyright) data via
  [VersaTiles](https://versatiles.org) vector tiles — which way each spot's
  coast faces

### Derived coast data

`v2/src/lib/spotCoast.gen.ts` holds the coast of each coastal spot in the
app's catalogue (a facing, a 16-direction fetch profile and an exposure),
derived from OpenStreetMap data by
`v2/scripts/model-check/coast-precompute.check.ts`, which also writes the test
fixture `v2/scripts/model-check/coast-fixture.json`. Map data © OpenStreetMap
contributors, see <https://www.openstreetmap.org/copyright>. Both are made
available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
The app derives the coast of your own spots on your device, the same way,
from the same tiles.

Fishing regulations in the app are **guidance only** — always verify on
[lfst.dk](https://lfst.dk) before fishing.
