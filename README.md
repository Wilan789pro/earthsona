# EARTHSONA: Hear the Earth. Understand the Change.

NASA Space Apps Challenge 2026 · **The Earth Information Jukebox**

EARTHSONA is a child-friendly way (ages 6–8) to explore Earth through sound, with **Luna, the Moon** as guide. Pick a world and a place on a 3D Earth, press play, and hear the place's **nature sounds** and a **tune**. **Both are shaped by real environmental measurements**: when the numbers change, the waves, birds, rain and music change too. The sounds are artistic interpretations generated from observations. They are not recordings made by satellites.

## Luna, the guide

Luna is a kawaii moon who goes round and round the Earth, on screen too: she orbits the globe and passes behind it. She guides the whole experience in a speech bubble and, after the first tap, **reads it aloud**, so children don't have to read.

1. **Welcome:** Luna introduces herself (first visit; the logo brings her back).
2. **Pick a world.** Ocean, Forest or Weather. The globe changes to show only that world:
   - **Ocean:** the sea in blues, darker where it is deeper (NASA Blue Marble bathymetry), with the land pale;
   - **Forest:** land greenness (MODIS NDVI), darker green where it is greener;
   - **Weather:** air temperature (MERRA-2), red where hot and blue/purple where cold.
3. **Pick a place.** Luna introduces it ("Tell me more" gives a short tip).
4. **Play.** Luna explains what you hear. **Why does it sound like this?** (or `W`) breaks it into nature, music and the measurements.
5. **After listening:** Luna reads out real facts (value and date), then asks a question. A right answer earns the world's badge, followed by **Why does it matter?** (Earth Impact Explorer), **Play with Luna**, or the next world.
6. **Badges:** "What would you do?", a printable certificate and prompts for parents and teachers.

**Luna's playground** (tap Luna, or press `L`) is the "Try this out" mode:
- **Pretend:** sliders start at the real latest measurement: how warm the sea is, how much forest is left, and rain, sunshine and air warmth. Moving one **repaints the Earth**:
  - the sea turns warmer colours and white "bleaching" patches appear;
  - the forest disappears in patches and the land goes bare;
  - pretend clouds roll in and the sunlight changes.
- **Hear it:** the change also reshapes the sound. At 0 % forest the birds and insects go quiet and the tune drops low and thin. Then Luna explains what happened and what *could* happen in real life.
- **Always labelled:** "Pretend Earth" on the globe and "make-believe, not a forecast" in the panel.
- **Two real years:** compares two real periods (A / B) with the same music rules and says what changed, not why.

**Voice:**
- **Device voices:** Luna uses this device's speech voices and prefers warm "Natural"/"Online" neural voices where available.
- **Natural pacing:** she speaks a little slower, at natural pitch, one sentence at a time with short pauses.
- **Controls:** the speaker button mutes her; pause and say-again are next to it; Esc stops her. Grown-ups can pick another voice in Settings.
- **Requirements:** nothing is recorded or sent anywhere. Browsers only allow speech after the first tap.

**Grown-ups' corner:** the science behind the sound:
- data types (analysis, satellite-derived or model);
- the chart and data table, and the full data → sound mapping;
- "What your child heard";
- sources and citations, settings, and WAV export.

**The Impact Explorer** keeps three kinds of statement apart, each with its own label:
- **real data from the dataset**;
- **what research says can happen** (linked NOAA, NASA and Drought.gov sources);
- **not checked for this place**.

## The nine featured experiences

| World | Place | Nature sounds | Regional music identity |
|---|---|---|---|
| 🌊 Ocean | Indian Ocean off **Mauritius** | gentle waves, lapping water, underwater hum | **Sega-inspired**: ravann-like drum, maravann-like shaker, triangle |
| 🌊 Ocean | Pacific off Oʻahu, **Hawaiʻi** | strong surf, rolling waves, coastal wind | not added yet: needs collaboration with Native Hawaiian musicians |
| 🌊 Ocean | **Open Central Pacific** | deep swell, deep-water rumble, wind | none by design |
| 🌳 Forest | **Black River Gorges**, Mauritius | wind in trees, leaves, birds, insects | subtle Sega-inspired **wooden taps** |
| 🌳 Forest | **Amazon**, Brazil | dense insects, many birds, light rain, distant thunder | not added yet: needs Indigenous and Brazilian musicians |
| 🌳 Forest | **Boreal forest**, Wood Buffalo, Canada | wind in needles, few birds, distant animal calls | none by design |
| 💓 Pulse | **Port Louis**, Mauritius | tropical showers, warm wind, thunder | Sega-inspired rhythmic accents |
| 💓 Pulse | **Kyoto**, Japan | steady rain, drops on roofs, light wind | not added yet: needs research with Japanese musicians |
| 💓 Pulse | **Ross Island**, Antarctica | strong polar wind, whistling gusts, creaking ice | none by design |

**How the measurements shape the sound** (the same rules for every place in a world):

| World | Data → music · Data → nature | Dataset | Kind of data |
|---|---|---|---|
| 🌊 Ocean | SST → melody pitch · SST anomaly → harmony (calm ↔ tense) · warmer sea → brighter waves | NASA/JPL **MUR SST v4.1** (preferred). Fallback: **NOAA Coral Reef Watch CoralTemp v3.1** SST + anomaly | Level 4 analysis (gap-free blend of satellite and in-situ data) |
| 🌳 Forest | NDVI → pitch and pad · EVI → harmony · greener → more birds, insects, rustling leaves (none at NDVI ≈ 0.1) | **MODIS MOD13Q1.061**, 250 m, 16-day, with pixel-reliability QA | Satellite-derived index |
| 💓 Weather | T2M → pitch · PRECTOTCORR → rhythm density · ALLSKY_SFC_SW_DWN → brightness · more rain → heavier rain and thunder · more sun → more birds | **NASA POWER** daily and monthly | Model-based estimates (MERRA-2); solar is satellite-derived (CERES) |

The kind of each value is shown in the app ("Science behind the sound" and the source dialog). A model value is never presented as a satellite reading.

**MUR straight from NASA (PO.DAAC):** MUR v4.1 on NASA Earthdata Cloud needs an Earthdata Login. We checked on 2026-11-13: CMR granule search is public, but OPeNDAP and Harmony both redirect to the login.

1. Create a free account at https://urs.earthdata.nasa.gov/.
2. Generate a token and put it in `.env` as `EARTHDATA_TOKEN=…` (see `.env.example`).
3. Run `npm run fetch-data -- --only=ocean`.

The script finds granules with CMR, samples one day per week and requests one grid cell of `analysed_sst` and `sst_anomaly` from each day's OPeNDAP granule. The anomaly is MUR's own, relative to the 2003–2014 day-of-year average. Responses are cached in `.cache/`, which is git-ignored. The token is read only by the Node script and never reaches the browser.

**Not yet verified:** the discovery step and the URL format were tested live, but reading the values themselves has not been run with a real token yet.

**About the ocean data in this build:** the MUR ERDDAP server (`coastwatch.pfeg.noaa.gov`) was unreachable from our network, so the fetch script automatically used NOAA Coral Reef Watch CoralTemp for **both** SST and its anomaly. The app labels this as **NOAA**, never as MUR. If you run `npm run fetch-data -- --only=ocean` where MUR is reachable (or set `ERDDAP_BASE`), MUR replaces it automatically.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (parsers against real saved responses, mappings, the nine experiences)
npm run build        # static site in dist/ (relative paths; runs offline)
npm run fetch-data   # refresh bundled data, imagery and EIC visuals (needs internet)
```

Node 18+ is required. No API keys or logins are needed. Copy `.env.example` to `.env` only to change the ERDDAP server. **Never commit `.env`**, and never put secrets in `VITE_*` variables (they are compiled into the public bundle).

## Honesty rules built into the code

- **No invented data in the experience.** If a layer has no real data, it stays silent and a notice says so. With no data at all, only the nature sound plays. The registry's simulated fallback is never played (it remains only for developer tests).
- Missing, cloudy or snowy dates are a soft "no data" tick; a single gap between two values is bridged and labelled "interpolated".
- The nature sounds and the music are shaped by the documented rules above, using **absolute** values, so the same number always sounds the same (unit-tested). The regional profile changes instruments and arrangement only, never what a value sounds like.
- **Luna's pretend changes** (globe paint and sound) are labelled "Pretend Earth" and "make-believe, not a forecast"; they start from the real measurement, and the real data never changes.
- **No forest-loss claims:** NDVI/EVI measure greenness, not trees.
- **EIC visuals:** each comes from the official EIC gallery or EIC Daily Visualizations, and its caption says how it relates to the sound (same dataset? same variable? which period?).
- **Natural sounds** are synthesised in the browser, so no recordings or licences are involved. The regional music is an original synthesised homage, not a recording.

## Fetching data and adding a place

```bash
npm run fetch-data                                   # everything
npm run fetch-data -- --only=ocean,eic               # parts: pulse | forest | ocean | eic | imagery
npm run fetch-data -- --only=pulse --region=kyoto    # one place
ERDDAP_BASE=https://<host>/erddap npm run fetch-data -- --only=ocean
```

The script:

- pauses politely between requests and retries once;
- validates every series: it must have values, at least 50 % of them valid (25 % when the gaps are provider-flagged cloud or snow), and all within a plausible range;
- writes files atomically and **never overwrites a good file with a failed one**;
- keeps one manifest entry per place, variable and period (a new provider replaces the old one);
- drops places that are no longer listed.

**To add a place:**

1. Add it to `regions` in `scripts/regions.json`. Include `short`, `kidIntro`, `context`, a `fact` with `factSource`, and an `ambience` preset (`src/audio/ambience.ts`). Add `music` only if a regional profile has been researched with the community; otherwise set `musicStatus` and `musicNote`.
2. List its id under an experience.
3. Run `npm run fetch-data`.

## Architecture

```
scripts/regions.json            places, periods, layers + roles, ambience, music status, EIC refs, imagery
scripts/fetch-nasa-data.mjs     pre-fetch (Node 18+, no deps) → public/data/real, public/data/eic, public/textures
src/data/parsers.js             URL building + parsing (POWER, MODIS, ERDDAP MUR/CRW, SVS) + dataTypeFor()
src/data/registry.ts            bundled → live → (simulated, never played by the app)
src/data/eic.ts                 EIC visuals (several per world)
src/sonification/*              documented data → sound mapping, frames, palettes
src/audio/ambience.ts           synthesised nature soundscapes, one preset per place, shaped by the data (natureModFor)
src/audio/engine.ts             music from the data (StepRenderer), nature shaping, buses, ducking, WAV export
src/audio/player.ts             play / pause / stop / replay / seek
src/ui/kid.ts                   child-friendly words and time windows
src/ui/narrator.ts              Luna's short "Tell me more" tips
src/ui/luna.ts                  Luna: kawaii moon SVG, orbit, speech bubble, warm voice
src/ui/playground.ts            Luna's playground: pretend sliders (globe + sound) and two real years
src/globeThemes.ts              each world's globe map from NASA images + pretend repainting
src/ui/missions.ts              Luna's lines, challenges, Impact Explorer chains, mini-game, progress
src/ui/impact.ts                Earth Impact Explorer (real-data box + general science)
src/ui/story.ts                 welcome, "What would you do?", badges + printable certificate
src/main.ts                     layout and wiring
```

**Why three.js and not CesiumJS:** the demo must work with no internet. Cesium's default imagery and terrain need an Ion token and online tiles. A three.js globe textured with bundled NASA GIBS imagery is reliable offline.

## Layout and accessibility

- **Layout:** one CSS grid; the regions never overlap (checked at 1440 and 400 px). Kids see only worlds, places, the globe with Luna, her bubble, a year picker and the player; everything technical is in the Grown-ups' corner.
- **Keyboard:** every action works from the keyboard. Space plays, `1`–`3` choose a world, `[`/`]` change place, `L` opens Luna's playground, `W` asks why it sounds like this, `N`/`M` toggle nature/music, Esc quiets Luna and closes things.
- **Feedback:** Luna's words are always on screen (and in a live region) while she speaks; visible playback state.
- **Fonts:** Fredoka and Nunito (SIL Open Font License), bundled in `src/fonts`, so it works offline.
- **Visual:** large controls, adjustable text size, and nothing conveyed by colour alone.
- **Sonification complements** the visual information; it is not claimed to replace it.

## GitHub workflow

Feature branches are merged into `master` through pull requests: `feature/nasa-data` → `feature/sonification-ui` → `feature/earthsona-2`. Never commit `.env` files or credentials.

## Known limitations

- **Ocean data** in this build comes from NOAA CoralTemp: no Earthdata token was available and the public MUR ERDDAP was unreachable (see above).
- **Regional music for Hawaiʻi and Japan** was requested, but it is deliberately not invented. It needs research and collaboration with musicians from those communities.
- **Voices** are the browser's built-in voices, so quality varies by device. Captions are always shown.
- **Points, not areas:** values are for one point or grid cell (POWER ≈ 0.5° × 0.625°, MODIS 250 m, CoralTemp 5 km, MUR ≈ 1 km).
- **Boreal forest gaps:** about half of the boreal composites are snow- or cloud-flagged, and you hear them as ticks.
- **Regional music:** only Mauritius has it, and the Sega-inspired profile still needs review by Mauritian practitioners. Hawaiʻi, the Amazon and Japan intentionally have none until it can be developed with musicians from those communities.
- **EIC timing:** the near-real-time EIC visuals show recent days, while the sound plays historical years; each caption says so.
- **Synthesised nature sounds** are naturalistic, not field recordings.
