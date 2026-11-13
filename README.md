# EARTHSONA: Hear the Earth. Understand the Change.

NASA Space Apps Challenge 2026 · **The Earth Information Jukebox**

EARTHSONA is an interactive, child-friendly way to explore Earth through sound. You pick a world and a place on a 3D Earth, press play, and hear three things:

1. the **natural soundscape** of that place,
2. a **sound made from real environmental measurements**, and
3. **regional music**, but only where a genuine, researched connection exists.

When the measurements change, the sound changes. The sounds are artistic interpretations generated from observations. They are not recordings made by satellites.

## The astronaut adventure

Children join a friendly astronaut, their **space buddy**, on a mission to discover Earth's secrets. The story follows ten scenes:

| Scene | What happens | Where in the app |
|---|---|---|
| 1 · The mysterious message | spaceship, Earth appears, a message arrives on the tablet | opens on the first visit; 🏠 Home replays it |
| 2 · Welcome aboard | the astronaut waves, a holographic Earth, badge slots | story dialog |
| 3 · Explore the Earth | the real 3D globe; the astronaut introduces the nine places | 🌍 Explore |
| 4 · Choose your mission | Ocean Symphony, Forest Voices, Earth's Pulse, in any order | mission chooser |
| 5–7 · The missions | seven steps each: Enter, Discover the data, Listen, Compare, Why it matters, Challenge, What can we do? | mission card (top of the right panel) |
| 8 · Earth Impact Explorer | tap to discover, step-by-step cause and effect, ask the astronaut, prediction challenge, positive actions | 🔍 Discover, or mission step 5 |
| 9 · What would you do? | four kind, guilt-free situations | 🏅 My Missions |
| 10 · Mission complete | badges, discoveries, replay, printable certificate, parent and teacher prompts | 🏅 My Missions |

- **The child sets the pace.** Back and Next always work and steps can be done in any order. Nothing speaks until **🔊 Hear it** is pressed. Every line has a caption, plus pause, stop and replay.
- **"Why does it sound like this?"** pops up the first time a place plays. It explains the nature sound, the regional music and the science sound. **🔬 Discover the science** shows the dataset, the variable, the actual value, its unit and date, and the source. **ⓘ Why this sound?** (or `W`) reopens it.
- **The Impact Explorer** keeps three kinds of statement apart, each with its own label:
  - **real data from the dataset**: the numbers in its top box are read from the loaded series;
  - **what research says can happen**, with linked NOAA, NASA and Drought.gov sources;
  - **not checked for this place**: for example, EARTHSONA did not look at any reef, and lower greenness does not prove tree loss.
- Progress and badges are stored only in this browser (🏅 My Missions → Start over erases them).

## The nine featured experiences

| World | Place | Natural sound (Layer 1) | Regional music (Layer 3) |
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

**Layer 2 (data)** is the same for every place in a world:

| World | Data → sound | Dataset | Kind of data |
|---|---|---|---|
| 🌊 Ocean | SST → melody pitch · SST anomaly → harmony (calm ↔ tense) | NASA/JPL **MUR SST v4.1** (preferred). Fallback: **NOAA Coral Reef Watch CoralTemp v3.1** SST + anomaly | Level 4 analysis (gap-free blend of satellite and in-situ data) |
| 🌳 Forest | NDVI → pitch and pad · EVI → harmony | **MODIS MOD13Q1.061**, 250 m, 16-day, with pixel-reliability QA | Satellite-derived index |
| 💓 Pulse | T2M → pitch · PRECTOTCORR → rhythm density · ALLSKY_SFC_SW_DWN → brightness | **NASA POWER** daily and monthly | Model-based estimates (MERRA-2); solar is satellite-derived (CERES) |

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

## Using it

- **Left:** 1 · choose a world (🌊 🌳 💓), 2 · choose a place, 3 · press play.
- **Centre:** the globe uses NASA GIBS imagery. "Data map" adds a NASA data overlay and "Night" shows the Black Marble. **Discovery cards** pop up when you pick a place or a time, with one fact, real values (date and unit), a mini chart and what to listen for. They can be dismissed and switched off in Settings.
- **Right:** the place in one sentence, a big "now" readout (value, date, what you hear), **Choose a time** (all years, one year, or quarters of a daily year), **Hear a tip**, the official **NASA EIC visual** and a folded **🔬 Science behind the sound** section (data types, period, pitch scale, chart and table, mapping, the three layers, "What you heard", fine layer control, WAV export).
- **Bottom player:** a large Play/Pause, Stop, Replay, progress with date, and **🌿 Nature / 📈 Data / 🎵 Music** toggles. Each switches a layer without restarting playback. There are also speed and volume controls.
- **✦ TRY THIS OUT ✦** opens the **Earth Sound Lab**:
  - **Compare real times:** pick a world, a place and two real periods (for example the Amazon in 2020 and in 2024). Listen to A, B, or A then B, and read what changed in the numbers and in the sound. The Lab describes what changed, never why.
  - **What if?:** a separate make-believe mode with sliders, clearly labelled. It is not a measurement and not a forecast, and one slider never changes another.

### Spoken tips

Tips are short (5–12 s), cover one idea and always have subtitles. They **never autoplay**. While a tip plays, the soundscape is turned down because you asked for the tip, and it comes back afterwards. Pause, Stop, Replay and Esc always work. Tips use the browser's built-in voices; if none is available, the subtitle is still shown.

## Honesty rules built into the code

- **No invented data in the experience.** If a layer has no real data, it stays silent and a notice says so. With no data at all, only the nature sound plays. The registry's simulated fallback is never played (it remains only for developer tests).
- Missing, cloudy or snowy dates are a soft "no data" tick; a single gap between two values is bridged and labelled "interpolated".
- The natural soundscape and the regional music **carry no data**. A sound profile changes instruments and arrangement only (unit-tested).
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
src/audio/ambience.ts           Layer 1: synthesised natural soundscapes, one preset per place
src/audio/engine.ts             Layer 2 + 3: StepRenderer, buses (nature / data / regional), ducking, WAV export
src/audio/player.ts             play / pause / stop / replay / seek
src/ui/kid.ts                   child-friendly words, time windows, discovery cards (numbers read from data)
src/ui/narrator.ts              short spoken tips with subtitles
src/ui/lab.ts                   Earth Sound Lab: compare real times + "What if?"
src/ui/astronaut.ts             the space buddy (original SVG) + optional voice with captions
src/ui/missions.ts              mission steps, challenges, Impact Explorer chains, mini-game, progress
src/ui/missionCard.ts           the seven-step mission card
src/ui/impact.ts                Earth Impact Explorer (real-data box + general science)
src/ui/story.ts                 scenes 1, 2, 4, 9, 10 and the printable certificate
src/main.ts                     layout and wiring
```

**Why three.js and not CesiumJS:** the demo must work with no internet. Cesium's default imagery and terrain need an Ion token and online tiles. A three.js globe textured with bundled NASA GIBS imagery is reliable offline.

## Layout and accessibility

- **Layout:** one CSS grid; the regions never overlap (checked at 1440, 1024 and 400 px). The only overlay is the dismissible discovery card over the globe; on phones it sits below the globe.
- **Keyboard:** every action works from the keyboard. Space plays, `T` plays a tip, `N`/`D`/`M` toggle layers, `1`–`3` choose a world, `[`/`]` change place, Esc closes cards and stops tips.
- **Feedback:** live-region announcements, a visible playback state and captions for narration.
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
