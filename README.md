# EARTHSONA: The Earth Impact Explorer

NASA Space Apps Challenge 2026 · **The Earth Information Jukebox** · Team AstroNopes

EARTHSONA is an interactive adventure for children aged 6–8.
- **Explore with Luna:** they explore the Earth with **Luna**, a friendly Moon who guides them, and **hear real NASA Earth observations turned into music**.
- **The story:** it begins with a short film. The Commander reports strange sounds from Earth, and the young astronaut (the explorer, that is, the child) opens her tablet… which becomes the app.

When the measurements change, the nature sounds and the music change too. The sounds are artistic interpretations generated from observations, not recordings made by satellites.

## Forest Voices: our own vegetation data + our own SuperCollider sounds

**The data:** `Datasets/EARTHSONA_Mauritius_Vegetation.csv`, read-only (never modified).
- **What it is:** a Google Earth Engine export of **NASA MODIS MOD13Q1.061** (Terra, 250 m, 16-day composites) at −20.2, 57.5 in central Mauritius.
- **Columns:** `NDVI` and `EVI` (already scaled, unitless), `SummaryQA` (0 good · 1 marginal · 2 snow/ice · 3 cloudy), `date`, coordinates and metadata. `.geo` is an empty geometry, so latitude/longitude are used.
- **Observations:** 2, dated 2024-01-01 (NDVI 0.860, EVI 0.683) and 2024-01-17 (NDVI 0.910, EVI 0.364). Both have QA *marginal*.
- **Quality:** no missing values or duplicates.
- **Caution:** EVI nearly halves in 16 days while NDVI rises, which is more likely haze or cloud edges in marginal pixels than a real change. The app says so.
- **Validation** (`src/data/forestCsv.ts`): rows with missing or out-of-range values, cloudy or snowy QA, bad dates or duplicates are rejected with a reason, never filled in.

**The sound:** the team's SuperCollider instrument `supercollider/cultural_sound/*.scd` is **ported to the browser** (`src/audio/cultural.ts`). SuperCollider can't run in a web page, so the port keeps:
- the same four recordings;
- the same `PitchShift` (0.1 s windows, 4 overlapping grains, pitch changes without changing speed);
- the same envelope and level;
- the same scheduler of overlapping starts.

Adaptations: the recordings' leading silence is trimmed so the beats land on time, and grain loudness is compensated.

**Data → music** (`src/sonification/forestVoices.ts`):
- **NDVI (greenness) → pitch:** 0.5 = original pitch, 0 = one octave lower, 1 = one octave higher, like the script's temperature → pitch.
- **EVI (leafiness) → sounds per second:** 0.25–3.0, like the script's wind → repeats.
- **Marginal quality → softer, duller sound.**
- **Listening to A then B:** the pitch glides between the dates, and the team's `triangle-sound` recording marks each date.

With the real file, A plays at pitch ×1.648 and 2.13 sounds/s; B plays at ×1.764 (1.2 semitones higher) and 1.25 sounds/s. Luna explains the difference and the haze caveat. The same samples are the cultural layer for the Mauritius places and for Kyoto (`yoooo-pulse` from `EarthPulseJapan.scd`), pitched by each place's data.

**What the samples are.** The four `.scd` scripts are identical apart from the file path, and none of them names an instrument. So the app does **not** call them ravann, maravann or any other Sega instrument. It describes them by file name: "a short percussive recording named forest2beat", and so on (`SAMPLE_INFO` in `src/audio/cultural.ts`).

> **Licensing:** please confirm the four recordings in `supercollider/cultural_sound/` were made by the team (or are licensed) before publishing.

## Luna

Luna sits beside her speech bubble and is always visible: the old orbit, which hid her behind the globe, is gone. She has gentle idle blinking and breathing, and **seven expressions** tied to what is happening:
- **happy:** welcome, listening;
- **curious:** new mission or place;
- **surprised:** a discovery in the data;
- **thoughtful:** explaining;
- **concerned:** an experiment that harms the forest, or no data;
- **encouraging:** "try again";
- **proud:** badges.

She speaks with Kokoro (`af_heart`), and you can ask her anything (Gemini, tuned for children aged 6–8).

## The journey band: observation → graph → musical change → meaning

Under the globe, four cards tell one story, from left to right:
1. **What the satellite saw:** the current real value, its date and its source.
2. **How it changed:** an interactive history graph (`src/ui/historyGraph.ts`).
   - **Axes:** x = date, y = the real measured value.
   - **Gaps:** dates with no usable measurement are grey clouds ☁ on the axis. Gaps are never filled in (interpolated points are drawn as gaps).
   - **Interaction:** hover (or use the arrow keys) to read a date. Touch (or Enter) to **hear** it. **Compare two dates** selects A and B, shades the period between them and shows the change.
   - **Trend badge:** ⬆ / ⬇ / ➡, from a least-squares trend with a "flat" threshold.
   - **Forest Voices sources:** a switch between NASA MODIS (Black River Gorges 2020–2024, about 104 dates) and **our team file** (the 2 CSV dates). Both are labelled and real.
3. **What you hear:** the player, with "⬆ higher note than the last date", "⬇ big drop!" and similar notes as it plays.
4. **What it means:** a plain-language, hedged explanation of the trend, plus the Earth Sound Lab.

## Earth Sound Lab: REAL EARTH DATA and WHAT IF?

- **🛰️ REAL EARTH DATA:**
  - The sliders show this place's latest real measurements and are locked.
  - The real starting values are listed with their date and source, for example: POWER T2M, rain and sunshine for Earth's Pulse; NOAA SST and anomaly plus the nearest point of the team's ocean CSV for the ocean; MODIS NDVI/EVI plus the team's CSV for the forest.
  - The sound plays the real values.
- **🪄 WHAT IF?:**
  - The sliders start from the real values (the tick marks "real start").
  - Moving them runs the simplified model (`src/lab/simulation.ts`) and the **scenario rules** (`src/lab/scenarios.ts`).
  - Everything is labelled **simulation**.
- **Continuous sound** (`src/audio/labLoop.ts`):
  - An endless 8-step phrase is built around the data note.
  - Every beat reads the current values, so a slider change is heard on the next beat (about 0.4 s).
  - Controls: play, pause, resume, stop, restart and volume. The AudioContext is resumed on every play and before each beat if the browser suspended it.
- **Scenario rules:** about 25 documented rules. Each rule has:
  - a **condition** with thresholds, for example "drought > 0.25 and heat stress > 0.25";
  - the **consequence**;
  - a **kid sentence** with hedged words ("could", "may");
  - the **visual response** and the **sound response** (lower notes, slower, tense harmony, the falling "uh-oh" figure, darker or brighter tone);
  - a **source**: NOAA Coral Reef Watch, NOAA Ocean Service, the WHO, NASA Earth Observatory, IPCC AR6 or Climate.gov.

  Several rules can fire together; the strongest three are shown.
- **Luna in the lab:**
  - Her face reacts at once.
  - She speaks about 0.9 s after the child stops moving a slider (debounced), and only when the situation changes.
  - She never interrupts herself: a new line waits until the current one ends, and only the latest waiting line is kept.
- **Animations** (`src/lab/scene.ts`), all easing smoothly and still under reduced motion:
  - **Forest:** crowns wilt, brown leaves fall as stress grows, and new leaves sparkle while health recovers.
  - **Ocean:** warm water tints the reef, stressed corals fade and shimmer, and fish thin out.
  - **Earth's Pulse:** a landscape where **the sun grows and brightens or shrinks and dims with the sunlight slider**; clouds and rain follow rainfall, lightning follows storms, hills follow plant growth, drought and snow; plus thermometer and CO₂ gauges.
- **Labels:** the picture is labelled "Drawing of real data" (REAL) or "WHAT IF? · simulation".

## Mapping specification

`src/sonification/mappingSpec.ts` documents every variable, and the table is shown in Grown-ups → The science → "Full mapping specification". For each variable it gives:
- the dataset and original unit;
- the normalisation range;
- the sound parameter, and what the lowest and highest values sound like;
- the direction;
- how change over time sounds.

The tests check that every range matches the code and that every mapping increases monotonically.

- **Global pitch scale by default:** one fixed range per variable, so **lower vegetation is always a lower note**, at every place and on every date. The relative "this place" scale is still available in Settings.
- **Significant drops change the arrangement:** a fall of ≥ 0.05 NDVI/EVI, ≥ 1 °C SST or ≥ 3 °C T2M since the previous date adds a falling two-note figure under the melody.

## The three missions

| Mission | Globe view (real NASA map) | Real data that drives the sound | Laboratory variables (simulation) |
|---|---|---|---|
| 🌊 **Ocean Symphony** | sea depth, darker where deeper (Blue Marble bathymetry) | sea surface temperature + anomaly | sea surface temperature, ocean acidity (pH), dissolved oxygen, pollution, nutrients, coral reef health |
| 🌳 **Forest Voices** | land greenness (MODIS NDVI) | NDVI + EVI (MODIS) | sunlight, rainfall, humidity, temperature, atmospheric CO₂, soil moisture |
| 🌍 **Earth's Pulse** | realistic day/night Earth (Blue Marble + Black Marble, lit from the real current Sun position); optional MERRA-2 temperature map | air temperature, rain, sunshine (NASA POWER, one place) | this place's air temperature, rain and sunshine (starting at the real POWER values), CO₂, plant cover, storms |

## Luna, the AI guide

Luna is a kawaii moon who sits beside her speech bubble, always visible. She guides you through each step, and you can **ask her anything** in her chat box.

- **AI answers:** her replies are generated by **Google Gemini** through the EARTHSONA backend.
- **Context:** each message carries a compact summary of what the app shows:
  - the mission and place;
  - the real dataset (variable, unit, latest, highest and lowest values with dates, the kind of data);
  - during an experiment, every slider with its baseline, the simulation's health indicators and its findings.

  Luna never has to guess the app state, and she keeps NASA observations, derived data and the simulation apart.
- **Voice:** she speaks with **Kokoro-82M** (voice `af_heart`), generated on the server. Kokoro runs at about real time on a laptop CPU, so Luna avoids waiting:
  - the first chunk is one short sentence (≤ 90 characters);
  - later chunks are fetched while she speaks;
  - every generated line is cached in memory and on disk (`backend/cache/tts`, git-ignored);
  - common lines (mission intros, lab lines, rule sentences) are **pre-generated in the background** when the app starts (`POST /api/luna/tts/prewarm`), and live requests always take priority.

  Measured time to first audio on the dev laptop: **0.05–0.15 s** for pre-generated or repeated lines, and **about 3–5 s** for a brand-new sentence (CPU-bound; her face, the words and the "preparing voice" indicator appear immediately). If the browser abandons a request (Luna interrupted), the server skips it instead of synthesising it.
- **Controls:** play, pause, resume, replay and stop, with captions (the bubble text), a speaking animation, a thinking indicator and a "preparing voice" indicator. Audio never overlaps.
- **Fallback:** if the backend is offline, the guided tour still works with the browser's voice, and the chat box explains how to start the server.

## Laboratories: "What happens if…?"

Press **Earth Sound Lab** (or `L`) to open the current mission's laboratory (see "Earth Sound Lab" above for the REAL / WHAT IF? modes).

- **Six variables:** each slider shows its **minimum, baseline (yellow tick), maximum and current value**, with a one-line explanation.
- **Interconnected and gradual:** variables act together through smooth, saturating responses rather than on/off switches (`src/lab/simulation.ts`). Moving one slider never wipes out an ecosystem. Examples:
  - reduced rain plus heat dries soil and leaves faster than either alone;
  - more CO₂ only helps when water and temperature allow it;
  - excess nutrients fuel blooms that use up oxygen;
  - doubling CO₂ implies about 3 °C of warming (the IPCC best estimate).
- **What you see:** an animated environment (`src/lab/scene.ts`) eases to each new state: leaf colour and density, soil, rain, wildlife; coral colour and bleaching, water clarity, fish, algae, oxygen bubbles; ice caps, coastlines, vegetation, storms, temperature and CO₂ gauges. "Show on globe" repaints the NASA map instead.
- **Health and comparison:** health indicators show a baseline marker, "Compare with baseline" switches back and forth, and "Reset to baseline" undoes everything.
- **Explanations:** "What's happening" text comes from the actual combination of settings. Luna can explain it in depth ("Ask Luna about this").
- **Hear this experiment** plays the latest real measurement, then the simulated version.
- **Two real years** compares two real periods with the same sound rules.
- **Labelling:** everything in the lab is labelled **Simulation (simplified educational model, not a NASA observation, not a forecast)**, next to a separate **Observed data** line showing the real value.

**Grown-ups' corner** (the science): data types, charts and tables, the full data → sound mapping, sources and citations, settings and WAV export. **Why does it matter?** (the Earth Impact Explorer) keeps real data, general research and "not checked for this place" apart.

## The nine featured experiences

| World | Place | Nature sounds | Regional music identity |
|---|---|---|---|
| 🌊 Ocean | Indian Ocean off **Mauritius** | gentle waves, lapping water, underwater hum | the team's recordings (`ocean2beat`, `triangle-sound`), pitched by the data |
| 🌊 Ocean | Pacific off Oʻahu, **Hawaiʻi** | strong surf, rolling waves, coastal wind | not added yet: needs collaboration with Native Hawaiian musicians |
| 🌊 Ocean | **Open Central Pacific** | deep swell, deep-water rumble, wind | none by design |
| 🌳 Forest | **Black River Gorges**, Mauritius | wind in trees, leaves, birds, insects | the team's `forest2beat` recording (Forest Voices) |
| 🌳 Forest | **Amazon**, Brazil | dense insects, many birds, light rain, distant thunder | not added yet: needs Indigenous and Brazilian musicians |
| 🌳 Forest | **Boreal forest**, Wood Buffalo, Canada | wind in needles, few birds, distant animal calls | none by design |
| 💓 Pulse | **Port Louis**, Mauritius | tropical showers, warm wind, thunder | the team's `triangle-sound` recording + a 6/8 swing from synthesised stand-in sounds |
| 💓 Pulse | **Kyoto**, Japan | steady rain, drops on roofs, light wind | the team's `yoooo-pulse` recording (from `EarthPulseJapan.scd`); no Japanese traditional music is claimed |
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
npm run dev          # http://localhost:5173 (start the backend too for Luna's chat and voice, see below)
npm test             # unit tests (parsers against real saved responses, mappings, the nine experiences)
npm run build        # static site in dist/ (relative paths; runs offline)
npm run fetch-data   # refresh bundled data, imagery and EIC visuals (needs internet)
```

Node 18+ and Python 3.11+ are required. The frontend needs no keys; Luna's backend needs a Gemini API key in `backend/.env`. **Never commit `.env`**, and never put secrets in `VITE_*` variables (they are compiled into the public bundle).

## Honesty rules built into the code

- **No invented data in the experience.** If a layer has no real data, it stays silent and a notice says so. With no data at all, only the nature sound plays. The registry's simulated fallback is never played (it remains only for developer tests).
- Missing, cloudy or snowy dates are a soft "no data" tick; a single gap between two values is bridged and labelled "interpolated".
- The nature sounds and the music are shaped by the documented rules above, using **absolute** values, so the same number always sounds the same (unit-tested). The regional profile changes instruments and arrangement only, never what a value sounds like.
- **Laboratory outputs are simulations:** they are labelled "Simulation" on the globe and in the lab, start from documented relationships (not fitted to any dataset), and never change or replace the real data shown next to them.
- **Luna (Gemini)** is instructed to use only the app context she is given, never invent numbers, datasets or citations, and say whether something is an observation, derived data or a simulation.
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

## Luna backend (Gemini + Kokoro)

`backend/` is a small FastAPI service:
- **Gemini:** Luna's answers come from Google Gemini through the official `google-genai` SDK.
- **Kokoro:** her voice is Kokoro-82M (ONNX build, voice `af_heart`).
- **The key stays on the server:** it lives in `backend/.env`, which is git-ignored, and is never sent to the browser or written to logs.
- **The browser only talks to `/api`:** in development, Vite proxies `/api` to `http://127.0.0.1:8000`.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe download_kokoro.py                     # Kokoro model files (~120 MB, once) into backend/models
Copy-Item .env.example .env        # then put your key after GEMINI_API_KEY=
.\.venv\Scripts\python.exe check_gemini.py                       # checks key + model, sends one real request
.\.venv\Scripts\python.exe -m uvicorn main:app --port 8000 --reload
```

In a second terminal, run `npm run dev` in the project folder, then open http://localhost:5173.

`GEMINI_MODEL` is configurable. `check_gemini.py` lists the models your key can use if the configured one isn't available. On 2026-11-14 `gemini-3.8-flash` was overloaded (503 and 504 errors), so `gemini-3.5-flash` is used.

Endpoints:
- `GET /api/health` reports whether the backend is up, the model name, and whether a key is configured (never the key itself).
- `POST /api/luna/chat` takes `{message, session_id, context?}`, where `context` holds the mission, place, experiment, slider values with their baselines, simulation outputs and a short dataset summary. It returns `{reply, session_id, model, audio}`.
- `POST /api/luna/tts` takes `{text}` and returns `audio/wav` spoken by Kokoro (cached; the model is preloaded at startup).

There are limits on message size, context size and requests per minute; the chat keeps 10 turns of memory per session and has a 30 s Gemini timeout, retrying when the service is temporarily overloaded.

Errors come back as `{error, message}`. The possible error kinds are `missing_key`, `invalid_key`, `quota`, `model_not_found`, `unavailable`, `timeout`, `network`, `rate_limited`, `upstream` and, for voice, `tts_not_installed` and `tts_failed`.

CORS allows the Vite dev server (`localhost:5173`); change it with `CORS_ORIGINS`.

## Sega: what the app does and does not claim

- **Recordings:** the team's four WAV files. Their instruments are not identified in the team's files, so they are named only by file name.
- **Synthesised:** the melody, harmony, pads, and the shaker-style noise, low thump and ting used as stand-ins. These are labelled "not a real maravann / ravann / triangle".
- **Generic effects:** all nature sounds, also synthesised.

EARTHSONA does **not** play Sega Tipik. Representing it respectfully would need:
- recordings of real **ravann**, **maravann** and **triang** by Mauritian musicians, with written permission, licence and credit;
- the ternary feel and accelerando, call-and-response singing in Kreol, and dance, reviewed by Sega practitioners;
- references: the National Heritage Fund and UNESCO, element 01003.

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
src/ui/luna.ts                  Luna: kawaii moon SVG, orbit, speech bubble, Kokoro voice (browser voice fallback)
src/ui/playground.ts            mission laboratories: six sliders, presets, health meters, compare/reset, two real years
src/lab/simulation.ts           interconnected six-variable models per mission (simplified, documented)
src/lab/scene.ts                animated environment for each laboratory
src/ui/lunaChat.ts              chat client for Luna's backend (session, context, errors)
backend/                        FastAPI: Gemini chat (services/gemini_service.py, luna_service.py), Kokoro TTS (tts_service.py)
src/globeThemes.ts              each world's globe map from NASA images + pretend repainting
src/ui/missions.ts              Luna's lines, challenges, Impact Explorer chains, mini-game, progress
src/ui/impact.ts                Earth Impact Explorer (real-data box + general science)
src/ui/story.ts                 welcome, "What would you do?", badges + printable certificate
src/data/forestCsv.ts           the team's vegetation CSV: parse + validate (read-only)
src/sonification/forestVoices.ts  NDVI/EVI → the SuperCollider instrument's pitch and starts
src/audio/cultural.ts           browser port of supercollider/cultural_sound/*.scd (samples + granular PitchShift + scheduler)
src/ui/forestVoices.ts          Forest Voices panel (two real dates, A/B, Luna's explanation, science)
src/ui/intro.ts                 introduction film → the app grows out of the explorer's tablet
src/ui/historyGraph.ts          interactive real-data history graph (hover, select, compare, trend)
src/sonification/mappingSpec.ts documented mapping specification (one row per variable)
src/lab/scenarios.ts            WHAT IF? rule engine (conditions, consequences, kid text, visual/sound response, source)
src/audio/labLoop.ts            the lab's continuous real-time sound (play/pause/resume/stop/restart)
src/data/oceanSnapshot.json     nearest real point of global_ocean_complete_data.csv for each ocean place
scripts/extract-ocean-snapshot.py  builds oceanSnapshot.json from the team's ocean CSV (read-only)
public/media/intro.mp4          the team's 52 s introduction film
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
- **Voice speed:** Kokoro runs at about real time on the CPU, so a brand-new long reply still takes a few seconds before speech starts (her face and the words appear immediately). Pre-generated and repeated lines start in about 0.2 s.
- **Ocean CSV:** the team's global ocean file is one month (June 2025) of scattered points; the nearest point to each place is 70–180 km away, and the lab says so.
- **Points, not areas:** values are for one point or grid cell (POWER ≈ 0.5° × 0.625°, MODIS 250 m, CoralTemp 5 km, MUR ≈ 1 km).
- **Boreal forest gaps:** about half of the boreal composites are snow- or cloud-flagged, and you hear them as ticks.
- **Regional music:** only Mauritius has a Sega-inspired swing, played with synthesised stand-ins; real Sega Tipik needs licensed recordings and review by Mauritian practitioners (see "Sega: what the app does and does not claim"). Hawaiʻi, the Amazon and Japan intentionally have none until it can be developed with musicians from those communities.
- **EIC timing:** the near-real-time EIC visuals show recent days, while the sound plays historical years; each caption says so.
- **Synthesised nature sounds** are naturalistic, not field recordings.
