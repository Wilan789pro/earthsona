# EARTHSONA sonification: what you hear and which data controls it

**Principle:** every audible musical or environmental sound is generated from a measured value. There are no recordings, no nature ambience, no background music and no fixed loops.
- If the data does not change, the sound does not change.
- If the data changes, the sound changes according to the rules below.

These rules are implemented in `src/sonification/mappings.ts`, `src/sonification/frames.ts` and `src/audio/engine.ts`, listed per variable in `src/sonification/mappingSpec.ts` (shown in Grown-ups → The science), and checked by tests.

## Three kinds of sound, kept apart

| Kind | What | Where |
|---|---|---|
| **1. Data sonification** | everything in the missions, the graph's Journey and Explore modes, Forest Voices, and the 🌍 Whole planet track | `engine.ts` (StepRenderer), `forestVoices.ts` |
| **2. WHAT IF? simulation** | the Earth Sound Lab's WHAT IF? mode: the **same rules** fed by the simplified model's values, plus the documented rule responses (`src/lab/scenarios.ts`). Always labelled "simulation". | `labLoop.ts`, `playground.ts` |
| **3. Not data** | **Luna's voice** (speech that explains; ducks the music while she talks) and the **intro film's own soundtrack**. There are no decorative interface sound effects. | `luna.ts`, `public/media/intro.mp4` |

**Missing data:** a date without a usable measurement plays a short, dull "no data" tick. That tick is the only sound for missing data, and it is the same everywhere.
- Interpolated (filled-in) dates count as missing.
- The optional "Smooth between measurements" setting (off by default) adds an airy whisper instead of a note, labelled as not measured.

## What each variable controls

All ranges are fixed for every place, so the same value always gives the same sound.

### Ocean Symphony: NOAA Coral Reef Watch CoralTemp (one point per place, weekly samples 2020–2024)
| Variable (unit) | Range | Sound parameter | Rule |
|---|---|---|---|
| SST, sea surface temperature (°C) | −2 … 32 | melody pitch | continuous over 3 octaves from G2; each note glides from the previous measured date |
| SST | ″ | Mauritius: Sega groove strength, shaker brightness, drum tuning | energy = SST level (0–1); drum tuned to the melody note, a few octaves down |
| SSTA, anomaly vs climatology (°C) | absolute thresholds | second voice | \|a\| < 0.5: fifth · 0.5–1.5: major second · ≥ 1.5: tritone; above the melody if warmer, below if cooler |
| SSTA | 0 … 2 °C (size) | Mauritius: Sega groove density | 1 to 6 of the six 6/8 beats; fill order 1, 4, 6, 3, 5, 2 |
| fall of ≥ 1 °C since the last date | — | falling two-note figure | under the melody, on that step only |

### Forest Voices: NASA MODIS MOD13Q1 (16-day) and the team's MODIS CSV
| Variable | Range | Sound parameter | Rule |
|---|---|---|---|
| NDVI (unitless) | −0.2 … 1 | melody pitch; pad fullness | continuous pitch from A2; pad filter opens with NDVI |
| NDVI | ″ | Mauritius: Sega groove strength and brightness | energy = NDVI level |
| EVI (unitless) | −0.2 … 1 | harmony richness | octave → fifth → major chord |
| EVI | ″ | Mauritius: Sega groove density | 1 to 6 beats |
| fall of ≥ 0.05 NDVI | — | falling two-note figure | |
| *Forest Voices, team CSV:* NDVI · EVI · SummaryQA | | pitch (±12 semitones around E4) · sounds per second (0.25–3.0) · softer and duller for "marginal" | the team's SuperCollider design, played by a synthesised pluck (no recording) |

### Earth's Pulse: NASA POWER (one point per place, monthly 2015–2024 or daily 2024)
| Variable | Range | Sound parameter | Rule |
|---|---|---|---|
| T2M, air temperature (°C) | −40 … 45 | melody pitch | continuous from E2 |
| PRECTOTCORR, rain (mm/day) | 0 … 30 | rhythm | 0–4 ticks per step; Mauritius: 1–6 Sega groove beats |
| ALLSKY_SFC_SW_DWN, sunlight (MJ/m²/day) | 0 … 35 | brightness | low-pass filter 500 → 5500 Hz; Mauritius: groove strength and shaker brightness |
| fall of ≥ 3 °C | — | falling two-note figure | |
| **🌍 Whole planet:** NASA GISTEMP v4 global annual anomaly (°C vs 1951–1980) | −1 … +2 | melody pitch | one year per step; a separate track, never mixed with POWER |

## Sega-inspired rhythm (Mauritius places only)

An original, programmatic 6/8 groove (`segaGroove` in `engine.ts`; `grooveDrive`, `grooveEnergy` and `groovePattern` in `mappings.ts`). It is not a recording, not a loop and not a copy of any song.
- **Density:** each data step is one bar of six subdivisions. The number that sound (1–6) follows a measured variable: rain (Earth's Pulse), the size of the SST anomaly (ocean) or EVI (forest).
- **Strength and brightness:** drum strength and shaker brightness follow sunlight, SST or NDVI.
- **Drum tuning:** the drum is tuned to the data note.
- **Missing data:** a missing measurement silences the groove.
- **Sounds used:** simple synthesis, a tuned sine drum and filtered noise. These are not real ravann or maravann sounds (see the README section "Sega: what the app does and does not claim").

## Determinism

The noise source has a fixed seed and every timing comes from the data. Offline renders of the same frames are identical except for floating-point rounding in the browser's audio engine: at most 2 of 65,536 levels, on a handful of samples. Raising the pitch level by 0.1 changes the audio substantially. This is checked in the browser test suite.

## What was removed, and kept for reference

| Removed from playback | Kept in the repository |
|---|---|
| Synthesised "nature" ambience (waves, birds, rain, wind, thunder) | `src/audio/ambience.ts` (not imported) |
| The team's four WAV recordings as a "cultural layer" and as the Forest Voices instrument | `supercollider/cultural_sound/*.wav` and `*.scd`, and `src/audio/cultural.ts` (not imported, so not bundled) |
| A fixed-pattern Sega drum, wooden taps and triangle "ting" that did not follow the data | replaced by the data-driven groove above |
| A random start position in the noise buffer | replaced by a fixed seed and offset |

## Limits, and what we do not claim

- **Ocean depth is not sonified.** The globe's "shallow sea / deep sea" colours come from the NASA Blue Marble bathymetry **image**, which is a picture, not depth values at our places. Sonifying depth would need a gridded bathymetry dataset (for example GEBCO) sampled at each place. SST is never presented as depth.
- **The Sega groove is an artistic mapping, not a physical one.** Rain does not "cause" rhythm; the mapping is a documented design choice, applied consistently.
- **The NASA SVS videos are visual context only:** different products, regions and dates from the sonified data, and not synchronised with the sound.
