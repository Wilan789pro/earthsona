# EARTHSONA: Earthy, the Earth Information Jukebox

NASA Space Apps 2026 · challenge **"The Earth Information Jukebox"**.
The app turns NASA Earth data into sound and shows a NASA Earth Information Center (EIC) visual beside it.

| Experience | What you hear | Data |
|---|---|---|
| **Ocean Symphony** | Sea surface temperature | ◇ **Simulated** (the SST source is still to be confirmed with our mentor) |
| **Forest Voices** | Vegetation greenness (NDVI, 16-day, 250 m) | ◆ **NASA MODIS MOD13Q1 v6.1**, via the ORNL DAAC web service |
| **Earth's Pulse** | Air temperature (T2M) and rainfall (PRECTOTCORR), monthly | ◆ **NASA POWER** (LaRC) |

The demo **does not need internet**. Real NASA data is pre-fetched and bundled in `public/data/real/`. If a file is missing, the app falls back to simulated data, which is always labelled as simulated.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (adapters parsed against real saved responses)
npm run build        # static site in dist/ (relative paths, so it can be opened from any static host)
npm run fetch-data   # refresh the bundled NASA data (needs internet, ~10–15 min)
```

Node 18+ is required. three.js, the fonts and the icons are all bundled locally, so nothing loads from a CDN at runtime.

## How data flows

```
scripts/regions.json ──► scripts/fetch-nasa-data.mjs ──► public/data/real/{experience}/{id}.json + index.json
        │                        │  (uses src/data/parsers.js)                  │
        ▼                        ▼                                              ▼
src/data/regions.ts      src/data/adapters/*  ──►  src/data/registry.ts  (bundled → live → simulated)
                                                         │
                                                         ▼
                                          src/data/normalise.ts  (one data-quality step for every source)
                                                         │ CleanSeries (EarthSeries + stats)
                    ┌────────────────────────────────────┼─────────────────────────────┐
                    ▼                                    ▼                             ▼
         src/audio/player.ts ─► engine.ts        src/ui/chart.ts            source badge / Understand / Earthy
         (one step event drives sound, playhead and "now playing" together)
```

* **`src/data/types.ts`** defines `EarthSeries`, the single normalised shape that every source returns.
* **`src/data/parsers.js`** holds all of the POWER, MODIS and SVS URL-building and parsing in plain JS. The browser adapters and the Node pre-fetch script both import it, so each parsing rule exists exactly once. The facts it relies on were checked against real responses:
  * **POWER:** `header.fill_value` is `-999.0` and becomes `null`. Monthly responses include a `YYYY13` row, which is the annual mean, and it is dropped.
  * **MODIS NDVI:** `scale` is `0.0001`, the fill value is `-3000`, and the valid range is `-2000…10000`. The subset endpoint rejects more than **10 dates per request**, so dates are fetched from `/dates` first and requested in batches of 10.
* **Adapters** (`src/data/adapters/`): `simulatedAdapter`, `powerAdapter`, `modisAdapter`, and `sstAdapter`. The SST adapter is still simulated; see the TODO in the file.
* **Registry** (`src/data/registry.ts`): tries the **bundled JSON** first, then the **live API** (only if live mode is on, with a 10 s timeout and an in-memory cache for the session), then **simulated**. It reports which one it used.
* **Normalisation** (`src/data/normalise.ts`): sorts by time, removes duplicates, and trims missing values at the start and end. A single missing point between two real values is interpolated and flagged `bridged`; longer gaps stay `null`. It then computes min, max and mean from observations only. The sound engine plays a short neutral "no data" tick for each gap, and the Listen guide explains it.
* **EIC hook** (`src/data/eic.ts`) reads metadata from the NASA SVS API (`/api/40509` Earth Now dashboard, `/api/5147` GEOS-FP temperature). SVS blocks cross-origin requests from browsers, so the pre-fetch script saves the metadata to `public/data/eic/` and bundles the image when it is ≤ 3 MB. It is kept separate from the rest of the code so the approach can change.

## Fetching data

```bash
npm run fetch-data                    # everything
npm run fetch-data -- --only=forest   # one of: pulse, forest, ocean, eic
```

The script pauses 1.2 s between requests and retries a failed request once. It logs each series with its point count and min/mean/max, then prints a summary. **It never overwrites a good file with an empty or failed result.** A series is rejected if it has no values, fewer than 50 % valid values, or values outside a plausible range (T2M −90…60 °C, NDVI −0.2…1). Files are written atomically, and `index.json` keeps entries for series that failed this run.

Last run (2026-11-11): 11 series written and 0 failed.

| Series | Points | min / mean / max |
|---|---|---|
| POWER T2M · Port Louis | 120 | 22.4 / 25.4 / 28.3 °C |
| POWER T2M · Amazon | 120 | 25.1 / 27.1 / 32.9 °C |
| POWER T2M · Sahara | 120 | 8.2 / 22.5 / 32.8 °C |
| POWER T2M · Svalbard | 120 | −18.1 / −5.5 / 5.7 °C |
| POWER PRECTOTCORR · 4 places | 120 each | 0.0 – 18.2 mm/day |
| MODIS NDVI · Black River Gorges | 115 | 0.49 / 0.82 / 0.96 |
| MODIS NDVI · Amazon | 115 | 0.15 / 0.76 / 0.92 |
| MODIS NDVI · Port Louis (urban) | 115 | 0.06 / 0.15 / 0.39 |

## Adding a region

1. Add the region to `regions` in **`scripts/regions.json`**, with an `id`, `name`, `lat`, `lon`, `biome`, and a `baseline` (used only for simulated data).
2. Add its `id` to the `regions` list of each experience it belongs to.
3. Run `npm run fetch-data -- --only=pulse` (or `forest`) and check the logged min/mean/max.
4. Commit the new files in `public/data/real/`. The app picks up the region automatically, because it reads the same `regions.json`.

To change the period, edit `start`, `end` and `periodKey` in the experience's `series` entry. POWER monthly takes years (`"2015"`); MODIS takes ISO dates.

## Live mode

Settings → **"Use live NASA data (requires internet)"** is **off by default**. When it is on, places with no bundled data are fetched from POWER or MODIS in the browser. This covers any point you click on the globe or find through search. If a request fails or takes longer than 10 s, the app falls back to simulated data and shows a notice in an `aria-live="polite"` region. Successful responses are cached in memory for the session. The **Data** menu in the player ("Best available" / "Simulated (compare)") lets you play the simulated version of the same place for comparison.

## Honest labelling

* Every experience shows a source badge with an icon and text: **"NASA data: NASA POWER"**, **"NASA data: NASA MODIS (ORNL DAAC)"**, or **"Simulated demonstration data — not a NASA observation"**. Clicking the badge opens the details: type, source, product and version, variable, place, period, where the data was loaded from, the exact request URL, the retrieval date, and the citation.
* The About & methodology dialog lists every source with its citation, and says what is real, what is simulated, and what is only decorative. The globe surface is a stylised drawing; the place search uses OpenStreetMap and is not NASA data.
* Removed from the prototypes because they implied NASA data that wasn't there: an Unsplash photo captioned "NASA GIBS", hard-coded "EONET" pins and "MODIS/VIIRS alerts", and a red "MODIS thermal" tint on the globe.

### Citations

* **NASA POWER:** "The data was obtained from the National Aeronautics and Space Administration (NASA) Langley Research Center (LaRC) Prediction of Worldwide Energy Resources (POWER) Project funded through the NASA Earth Science Division." The service name, API version and access date are added for each dataset. (power.larc.nasa.gov/docs/referencing)
* **MODIS web service:** ORNL DAAC. 2018. Terrestrial Ecology Subsetting & Visualization Services (TESViS) RESTful Web Service. ORNL DAAC, Oak Ridge, Tennessee, USA. https://doi.org/10.3334/ORNLDAAC/1600
* **MOD13Q1:** Didan, K. (2021). MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid V061. NASA EOSDIS LP DAAC. https://doi.org/10.5067/MODIS/MOD13Q1.061
* **EIC visuals:** NASA Scientific Visualization Studio and the Earth Information Center, Earth Now dashboard (https://svs.gsfc.nasa.gov/gallery/earth-now-dashboard/).

## Testing

* `npm test` runs 23 unit tests. They cover each adapter's parsing against **real saved responses** in `tests/fixtures/` (Port Louis, saved 2026-11-11): fill values, scale factor, MODIS batching and SVS frame selection. They also cover the normaliser (gaps, interpolation, stats) and the registry's fallback order (bundled → live → simulated, live timeout, network down, forced simulated).
* An end-to-end browser check was also run against the dev server. It switched between real and simulated data in each experience and confirmed that the sound status, "now playing", the chart playhead and the badge change together. It then blocked all non-localhost traffic and confirmed the app still runs, using bundled and simulated data with the polite fallback notice. Result: 20/20 passing. That script is not committed; ask if you want it added as `npm run e2e`.

## Known limitations

* **Ocean Symphony is fully simulated.** The intended source is JPL MUR SST via ERDDAP (see `src/data/adapters/sstAdapter.ts`).
* Each value is for a single point, not an area. POWER cells are about 0.5° × 0.625° (MERRA-2), and MODIS uses one 250 m pixel. Cloud-contaminated MODIS composites can produce low outliers; for example, the Amazon minimum of 0.15 is likely one of these. The data is not QA-filtered yet.
* Pitch is scaled within each series. The same note means different values in different places, so compare the numbers shown, not the pitch.
* Two of the three EIC images (Earth Now SST and true colour) are 5–9 MB and are not bundled. Offline, the app shows their alt text instead. The GEOS-FP temperature frame is bundled.
* The bundled data is a snapshot (POWER 2015–2024 monthly, MODIS 2020–2024). Live mode only applies to places without bundled data.
* Simulated series are deterministic for each place and labelled everywhere, but they are not climatologically accurate.
