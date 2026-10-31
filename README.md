# lostless_

A tiny **personal navigation app**. World map, live GPS, search or tap-to-pin, turn-by-turn
routes for car / walk / bike, screen stays awake while navigating, favorites saved on-device.

**100% free — no API keys, no accounts, no credit card.**

UX: frosted-glass "apple-chic" UI (curved panels, pills and switches) on top of a minimal
mono/abstract base. Hitting **START** enters a full-screen **navigation mode** (Neshan/Balad
style): big next-turn card with progress bar, arrival time, remaining distance, live speed,
optional voice guidance (browser speech engine), heading-rotated map and a snapped-to-route
GPS dot with an accuracy bubble. A side **drawer** holds saved places, settings (theme,
map style: dark/light/liberty/bright, Persian `name:fa` labels, voice, lite mode) and about.
On older phones a **LITE MODE** auto-enables on weak hardware (≤4 cores / ≤4 GB RAM):
lightweight raster map + no animations; if the WebGL map ever fails, the app automatically
falls back to the raster map instead of showing a blank map.

| Need | What we use | Cost |
|---|---|---|
| Map rendering | [MapLibre GL JS](https://maplibre.org/) (open source) | free |
| Map tiles | [OpenFreeMap](https://openfreemap.org/) public instance (vector tiles, no key) | free, attribution shown |
| Place search | [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap) | free, max 1 req/s (enforced in-app) |
| Routing | public FOSSGIS **Valhalla** instance (car/walk/bike) or OSRM demo | free, fair use |

Web app first (installable PWA), phone-first layout, dark mode by default with a light toggle.

---

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

GPS needs a secure context — `localhost` counts as secure, so location works in dev.
For testing on a real phone against your computer, use e.g. `npm run dev -- --host` and
open `https://<your-lan-ip>:5173` (needs a cert) — or just deploy (see below) and test there.

```bash
npm test           # unit tests (geo math, maneuver glyphs, config integrity)
npm run build      # production build into dist/ (also type-checks)
npm run preview    # serve dist/ locally
```

CI runs `npm ci && npm test && npm run build` on every pull request and push to
`main` (`.github/workflows/ci.yml`) — a red check means don't merge. The suite
includes a jsdom smoke test that drives the whole flow (search → pick → route →
START → STOP, map-tap → pin, GPS-denied banner) with a mocked map/network.

**Performance:** the map library is lazy-loaded and warmed during browser idle, so the
initial JS is ~57 kB gzip and the ~290 kB gzip MapLibre chunk prefetches in the background;
`preconnect`/`dns-prefetch` hints warm up the tile/geocoding/routing hosts; the service
worker precaches the app shell and caches only HTTP-200 map tiles. In the Arena live
preview (`*.e2b.app`) all external calls go through same-origin `/proxy/*` paths that
vite forwards, and the MapLibre worker is served same-origin so a strict CSP can't blank
the map.

## Deploy for free

### Option A — GitHub Pages (already wired up)

A workflow is included (`.github/workflows/deploy-pages.yml`): every push to `main`
builds the app and publishes `dist/` to GitHub Pages automatically.

1. Push this repo to GitHub.
2. Repo → **Settings → Pages** → **Source: GitHub Actions**.
3. Push to `main` (or merge the PR) → the workflow runs → your app is live at
   `https://<your-username>.github.io/lostless/`.

No secrets, no keys. The build uses `base: './'`, so it works under the `/lostless/`
sub-path automatically.

> ⚠️ **Free-plan caveat:** on GitHub Free, Pages can only publish from **public**
> repositories (private repos need Pro/Team/Enterprise). This repo is currently
> **private** — so either make the repo public (fine for an open-source toy), or use
> Option B (Vercel), which happily builds private repos on the free hobby plan.
> The published Pages site is always public, even from a paid private repo.

### Option B — Vercel (also free)

1. Push the repo to GitHub.
2. Go to [vercel.com](https://vercel.com), **Add New → Project**, import the repo.
3. Framework preset: **Vite**. Build command: `npm run build`. Output: `dist`.
   (Vercel auto-detects these from `package.json` — just click Deploy.)
4. Live at `https://<project>.vercel.app`. Every push to `main` redeploys.

Both are HTTPS, which the GPS API requires.

## Install on Android (PWA)

1. Open the deployed URL in Chrome.
2. Tap **⋮ → "Add to Home screen"** (or "Install app").
3. The app appears on your home screen and opens fullscreen, no browser chrome.
4. First load must be online (the service worker then caches the app shell + map tiles,
   so it starts offline afterwards; routing/search need connectivity).

**Background GPS later:** PWAs can't track location with the screen off. When you need that,
wrap this same web app with [Capacitor](https://capacitorjs.com/):
`npm i @capacitor/core @capacitor/android`, `npx cap init`, `npx cap add android`,
`npm run build && npx cap sync`, then open in Android Studio. The web code doesn't change —
add `@capacitor/geolocation` + a background-geolocation plugin only if/when you need it.

## Configuration — one file

All external services are configured in **`src/config.ts`** and nowhere else:

- tile style URLs (dark/light), initial map center
- Nominatim base URL + rate limit
- routing engine (`'valhalla'` or `'osrm'`) and its base URL / costing / profiles
- re-route threshold

To run your own routing server later: host Valhalla or OSRM, change one URL in
`src/config.ts`, redeploy. Done.

## Limits of the free public services (and what to do when you outgrow them)

- **Nominatim** — hard limit **1 request/second** per IP, fair-use only (no bulk
  geocoding, no scraping). The app respects this: it searches on **Enter**, never per
  keystroke, and throttles client-side. If you ever hit `403/429`, wait a minute; if
  you need more, self-host Nominatim or use a paid provider (Photon, geocode.maps.co…).
- **Valhalla (valhalla1.openstreetmap.de)** — public FOSSGIS instance, fair use, can be
  slow or briefly down, and there is no SLA. If routing fails, the app shows a banner
  with **RETRY**; switch `routing.engine` to `'osrm'` (demo server has **car only**) or
  point `routing.valhalla.baseUrl` at your own Valhalla/OSRM instance.
- **OSRM demo (router.project-osrm.org)** — public demo loads only the `driving`
  profile; fine for car, not for walk/bike. Self-host OSRM with all profiles if needed.
- **OpenFreeMap tiles** — free with attribution (shown on the map), fair use. Heavy
  traffic should self-host vector tiles (e.g. from Geofabrik extracts + `tileserver-gl`).
- **OpenStreetMap data** — © OpenStreetMap contributors, ODbL. Keep the attribution
  (the app does).
- **PWA limits** — no background GPS while the screen is off (see Capacitor note above);
  Screen Wake Lock works in Chrome/Edge/Samsung Internet and Safari ≥ 16.4.

**Privacy note:** search, reverse-geocoding and routing requests go to those public
servers (your approximate location is visible to them). Favorites never leave the device
(localStorage). If that bothers you, self-host all three services.

### Self-hosting toolbox (all open source, found on GitHub)

| Job | Repo | Notes |
|---|---|---|
| Map tiles + styles | [hyperknot/openfreemap](https://github.com/hyperknot/openfreemap) | one-command self-host of OpenFreeMap tiles/styles |
| Tile server (generic) | [maptiler/tileserver-gl](https://github.com/maptiler/tileserver-gl) | serves MBTiles/GeoJSON + styles, works with MapLibre |
| Styles for self-hosting | [teamapps-org/maplibre-gl-styles](https://github.com/teamapps-org/maplibre-gl-styles) | MapLibre style collection incl. dark styles |
| Routing | [valhalla/valhalla](https://github.com/valhalla/valhalla) (+ [nilsnolde/docker-valhalla](https://github.com/nilsnolde/docker-valhalla)) | all modes; point `config.routing.valhalla.baseUrl` at it |
| Routing (alt) | [Project-OSRM/osrm-backend](https://github.com/Project-OSRM/osrm-backend) | set `routing.engine: 'osrm'` + your URL |
| Search | [osm-search/Nominatim](https://github.com/osm-search/Nominatim) (+ [mediagis/nominatim-docker](https://github.com/mediagis/nominatim-docker)) | set `config.nominatim.baseUrl` |
| Search (lighter alt) | [komoot/photon](https://github.com/komoot/photon) (+ docker images) | Elasticsearch-based, fast autocomplete |

OSM planet extracts for all of the above: [download.geofabrik.de](https://download.geofabrik.de).

## Stack

Vite + React + TypeScript, MapLibre GL JS, self-hosted fonts (Space Grotesk + JetBrains
Mono via Fontsource), `vite-plugin-pwa` for the service worker, plain CSS (no framework).
No backend, no database, no keys.

## Project layout

```
src/
  config.ts          ← ALL external service URLs (change these to self-host)
  App.tsx            ← state + wiring
  components/        ← MapView, Sheet, TopBar, SearchBox, RoutePanel, StepsList, NavOverlay, MapButtons
  lib/               ← geocode (Nominatim), routing (Valhalla/OSRM), geo math, storage, wake lock
  hooks/             ← geolocation, theme
public/              ← manifest.webmanifest, favicon, PWA icons
scripts/make_icons.py  ← regenerates the PNG icons (python3 + pillow)
```
