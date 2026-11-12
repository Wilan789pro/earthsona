# EARTHSONA: Hear the Earth. Understand the Change.

NASA Space Apps Challenge 2026 · **The Earth Information Jukebox**

EARTHSONA turns real NASA Earth measurements into data-driven sound. You pick a place on a 3D Earth that uses real NASA imagery, read a short sourced introduction to it, and listen to its ocean temperature, vegetation, rainfall and sunlight played as music.

**Sound is the product.** The globe, panels and charts are there to support listening.

```
NASA dataset → processing (fill values, QA, units) → normalisation → documented mapping → music → audio
   adapters      src/data/parsers.js + normalise.ts     sonification/frames.ts   mappings.ts   audio/engine.ts
```

| Experience | Layers and what you hear | Dataset |
|---|---|---|
| 🌊 **Ocean Symphony** | SST → melody pitch · SST anomaly → harmony (calm ↔ tense) | NASA/JPL **MUR SST v4.1** (GHRSST L4, ~1 km), weekly samples, via NOAA ERDDAP |
| 🌳 **Forest Voices** | NDVI → melody pitch and background pad · EVI → harmony (thin ↔ full chord) | **MODIS MOD13Q1.061** Terra, 250 m, 16-day, with pixel-reliability QA, via ORNL DAAC |
| 💓 **Earth's Pulse** | T2M → melody pitch · PRECTOTCORR → rhythmic density · ALLSKY_SFC_SW_DWN → brightness | **NASA POWER** (LaRC), monthly 2015–2024 and daily 2024 |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests: parsers against real saved responses, mappings, registry
npm run build        # static site in dist/ (relative paths; runs offline)
npm run fetch-data   # refresh the bundled NASA data and imagery (needs internet)
```

Node 18+ is required. No API keys or logins are needed. Copy `.env.example` to `.env` only if you want to change the ERDDAP server. **Never commit `.env`**, and never put secrets in `VITE_*` variables, because those are compiled into the public bundle.

## Using it

- **Left column:** pick an experience (keys `1`/`2`/`3`), then a place (`[` / `]`), or click anywhere on the globe.
- **Centre:** the globe uses NASA GIBS Blue Marble imagery, plus an optional NASA data overlay (MUR SST, MODIS NDVI or MERRA-2 air temperature) and an "Earth at night" view (VIIRS Black Marble).
- **Right column, four tabs:**
  - **Location:** context, a sourced fact, which data exists for the place, and the NASA Earth Information Center visual.
  - **Listen:** source badge, time period, pitch scale (*relative* to this place or *global* so places can be compared), sound profile, chart and table, "now playing", the mapping table and "What you heard".
  - **Sound Lab:** "Try this out".
  - **Guide:** Discover → Learn → Listen → Explore → Understand. It is optional and can be skipped.
- **Bottom player:** play/pause (`Space`), stop (`S`), replay, a seekable progress bar with date and time, speed, volume, waveform, per-layer toggles and WAV export.

### Sound profiles (regional music)

A profile changes **instruments and arrangement only**. The same value always gives the same note, rhythm density, brightness and harmony in every profile (this is unit-tested). The mapping is defined in `src/sonification/mappings.ts`.

- **Neutral scientific:** plain synthesised tones. Every sound comes from data.
- **Mauritius, Sega-inspired:** offered only for places in Mauritius. It is an original synthesised homage, not a recording, built on the instruments named by the National Heritage Fund and UNESCO: ravann (frame drum), maravann (box rattle) and triangle.
  - Rainfall → shaker density.
  - Sunlight → triangle brightness.
  - The frame drum only marks the beat and **carries no data**.
  - The ternary (6/8-style) groove is our own design choice and **must be reviewed with Mauritian practitioners** before public use.

  References: [NHF: Sega Tipik Morisien](https://nhf.govmu.org/nhf/?page_id=723), [UNESCO multimedia archive](https://www.unesco.org/archives/multimedia/document-3665), [UNESCO ICH element 01003](https://ich.unesco.org/en/RL/traditional-mauritian-sega-01003).

### Earth Sound Lab

- **Mode 1, Real Earth data:** choose a date. The sliders show the actual observation (read-only) and its source.
- **Mode 2, Hypothetical scenario:** move the sliders. Everything is labelled **simulated**.
- **A/B:** play the observation (A), then your scenario (B). A table shows both sets of values and what changes in the sound.
- Each slider controls only its own sound layer. The Lab does not model links between variables, and a scenario is not a forecast.

## Data access and honesty

| Source | Access | Notes |
|---|---|---|
| NASA POWER point API | open, CORS `*` | Fill value `-999` → no data; monthly `YYYY13` (annual) row dropped; units taken from the response (AG community: `MJ/m²/day` for solar) |
| ORNL DAAC MODIS REST | open | Scale `0.0001`; fill `-3000`; valid range `-2000…10000`; ≤ 10 dates per request (batched); `pixel_reliability` 2 (snow) and 3 (cloudy) → no data, 1 → kept and flagged *marginal* |
| MUR SST via ERDDAP | open | `jplMURSST41` (`analysed_sst`) and `jplMURSST41anom1day` (`sstAnom`). The anomaly is the dataset's own (we never compute one), and its baseline note is copied from the dataset metadata at fetch time. Server set by `ERDDAP_BASE` |
| NASA GIBS WMS | open | Globe textures and overlays, bundled |
| NASA SVS API | open, but no browser CORS | EIC frames pre-fetched; large images stay remote |

Every data point carries a **quality** status: `good`, `marginal`, `cloudy`, `snow`, `missing`, `interpolated` or `simulated`. The source badge, the source dialog (dataset, product and QA, exact request URL, retrieval date and citation for each layer) and "What you heard" always say what is real, what is cached, what is simulated and what is hypothetical.

The registry tries **bundled files → live API (only when "Use live NASA data" is on; 10 s timeout) → simulated**. Fallbacks are announced in a polite `aria-live` notice row. The demo runs fully offline.

## Fetching data and adding a place

```bash
npm run fetch-data                          # everything
npm run fetch-data -- --only=pulse,forest   # parts: pulse | forest | ocean | eic | imagery
ERDDAP_BASE=https://<host>/erddap npm run fetch-data -- --only=ocean
```

The script pauses politely between requests, retries once, validates each series (it must have values, at least 50 % of them valid, and all within a plausible range), writes files atomically, **never overwrites a good file with a failed or empty result**, and prints a summary.

**To add a place:**
1. Add it to `regions` in `scripts/regions.json`. Include `country`, `context`, a `fact` with `factSource`, and `music` only if a regional profile has been researched for it.
2. List its `id` under each experience that should use it.
3. Run `npm run fetch-data`.

The app and the script read the same file.

## Architecture

```
scripts/regions.json            places, periods, layers + roles, imagery (single source of truth)
scripts/fetch-nasa-data.mjs     pre-fetch (Node 18+, no deps) → public/data/real, public/data/eic, public/textures
src/data/types.ts               EarthSeries / EarthPoint (+quality) / SeriesDef (+roles) / PeriodDef
src/data/parsers.js             all URL building + parsing (shared by browser and script)
src/data/adapters/*             power · modis · sst (ERDDAP) · simulated
src/data/registry.ts            bundled → live → simulated; getTrack() loads all layers of a period
src/data/normalise.ts           sort, trim, bridge single gaps, stats on observations only
src/sonification/mappings.ts    THE documented data → sound rules
src/sonification/frames.ts      Track → SoundFrames (layers aligned by date)
src/sonification/palettes.ts    neutral + Sega-inspired (instruments/arrangement + references)
src/audio/engine.ts             Web Audio StepRenderer (live and offline WAV share it)
src/audio/player.ts             play / pause / stop / replay / seek
src/globe.ts                    three.js globe with GIBS textures and overlays
src/ui/*                        chart, lab, guide, DOM helpers
```

**Why three.js and not CesiumJS:** the demo must work with no internet. Cesium's default imagery and terrain need an Ion token and online tiles, and its bundle is much larger. A three.js globe textured with bundled NASA GIBS imagery is reliable offline and fast, which the brief explicitly allows.

## Layout and accessibility

- **Layout:** one CSS grid with header, notice row, navigation, globe, panels and player. These regions never overlap; this is checked automatically at 1440, 1024 and 400 px. On narrow screens the navigation becomes a collapsible drawer and the page scrolls.
- **Keyboard:** every action is reachable by keyboard (tabs follow the WAI-ARIA tabs pattern; shortcuts are listed in ⌨). Screen-reader announcements cover loading, playback, fallbacks and layer changes.
- **Text and visual alternatives:** text size is adjustable with A−/A+. The chart has a data table, and "now playing" shows the values as text.
- **Not colour alone:** source badges use text plus an icon.
- **Volume:** a compressor keeps loudness comfortable.

## GitHub workflow

The work is split into feature branches: `feature/nasa-data` (data layer) and `feature/sonification-ui`, which contains sonification, regional music, globe, Sound Lab and guide in separate commits. Merge them into `master` through pull requests, in that order. Never commit `.env` files or credentials.

## Known limitations

- **Ocean Symphony needs the MUR fetch to succeed.** During development the default ERDDAP server (`coastwatch.pfeg.noaa.gov`) was unreachable from our network, so ocean plays clearly labelled simulated data until `npm run fetch-data -- --only=ocean` succeeds (try another network or set `ERDDAP_BASE`).
- **Values are for points, not areas:** POWER grid cells are about 0.5° × 0.625° (MERRA-2 based), MODIS uses one 250 m pixel, and MUR is about 1 km.
- **NDVI and EVI measure greenness**, not tree counts or deforestation. Seasons and land use change them.
- **Relative pitch** is per series; use **Global** pitch to compare places.
- **The Sega-inspired profile** is an original interpretation and needs review by cultural practitioners.
- **Live mode** applies only to places without bundled data.
