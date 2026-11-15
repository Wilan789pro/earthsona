# EARTHSONA: NASA Space Apps Challenge 2026 submission notes

Challenge: **The Earth Information Jukebox** · Team **AstroNopes**.
This file collects what we can state factually for each submission section, and what the team still has to check.
Items marked **☐ TEAM** need a team member's input or action.

---

## A. High-level summary (≈ 150 words)

> EARTHSONA turns real Earth-science measurements into music so that children aged 6–8 can hear how our planet changes. For *The Earth Information Jukebox*, it pairs NASA Earth Information Center visualisations with a live, data-driven soundtrack in three missions: Ocean Symphony (sea-surface temperature), Forest Voices (NASA MODIS vegetation greenness) and Earth's Pulse (NASA POWER air temperature, rain and sunshine, plus NASA GISTEMP's whole-planet temperature record since 1880). Every note, rhythm and tone comes from a documented rule applied to observations: greener land sounds higher, rainier days sound busier, and gaps in the data stay silent rather than being invented. Luna, a friendly Moon, guides children through a short tour, explains what they hear, and helps them try clearly labelled "What if?" experiments in the Earth Sound Lab. Sonification makes Earth data more engaging, and accessible to blind and low-vision learners, so satellite numbers become something children can hear and remember.

## B. Demo and project link

- **Project link:** the public site, after deployment (see `deploy/DEPLOYMENT.md`). It must open without passwords or registration. **☐ TEAM:** deploy and paste the URL.
- **Repository:** https://github.com/Wilan789pro/earthsona (public).
- **30-second video or up to 7 slides:**
  1. The problem: Earth data is hard for young children to grasp; numbers are visual-only.
  2. The globe + choosing a world (Ocean / Forest / Pulse), with the NASA EIC video as context.
  3. **Journey mode:** "Next date" through real observations, so pitch, graph and value move together (show a drop in NDVI → lower note + "uh-oh" figure).
  4. Earth's Pulse 🌍 Whole planet: GISTEMP 1880 → today as a climbing melody.
  5. Earth Sound Lab: REAL data vs WHAT IF?, with Luna explaining every change.
  6. Accessibility: keyboard, screen-reader readouts, text descriptions of sound and pictures.
  7. Data sources and honesty rules (NOAA vs NASA labelled; no invented values).
- **☐ TEAM:** do not show any names, voices or likenesses of anyone under 18. Check the intro film (`public/media/intro.mp4`) before using it in the demo.

## C. Project details (what it does, how it works, benefits, tools)

- **What it does:** a web app with three missions. Each mission sonifies real observations at real places and shows the NASA picture context. Each has an interactive graph, a "what you hear" explanation, and a lab for clearly labelled pretend scenarios.
- **How it works:**
  - The data is pre-fetched (NASA POWER, MODIS via ORNL DAAC, NOAA CRW) or comes from the team's CSV files.
  - It is cleaned: QA flags respected; missing dates kept as gaps.
  - It is mapped by documented rules (`src/sonification/mappingSpec.ts`) to pitch, harmony, rhythm, brightness and texture.
  - It is synthesised in the browser (Web Audio), including a browser port of the team's SuperCollider instrument.
  - Luna's chat uses Google Gemini through a small FastAPI backend that holds the key; her voice is Kokoro-82M.
- **Benefits:**
  - **Education:** cause and effect are heard and seen together.
  - **Honest data literacy:** real vs simulated, NOAA vs NASA, missing data.
  - **Accessibility:** sonification, screen-reader text, keyboard use, AA contrast.
- **Languages and tools actually used:**
  - **Code:** TypeScript, HTML, CSS, Python.
  - **Frontend:** Vite, three.js, Web Audio API.
  - **Backend:** FastAPI, uvicorn, google-genai, kokoro-onnx / ONNX Runtime.
  - **Testing:** Vitest; Playwright scripts.
  - **Media:** FFmpeg, used to optimise copies of the NASA videos.
  - **Sound design:** SuperCollider, for the team's original instrument scripts.
  - **Hosting plan:** Git/GitHub, GitHub Pages, Hugging Face Spaces.

## D. Use of synthetic intelligence (AI) — draft disclosure

Known from the development sessions:
- **Anthropic Claude (Claude Code)** was used as a coding assistant to write and test much of the application code, documentation and tests, under the team's direction and review.
- **Google Gemini** (`gemini-3.5-flash`) generates Luna's chat answers at runtime. The app gives it the current data context and rules: it must not invent data, and real data and simulation are kept apart.
- **Kokoro-82M** (open-weights text-to-speech, Apache-2.0) generates Luna's voice.
- `public/media/intro.mp4` contains an **Anthropic C2PA content credential** ("Claude provided this file … may have created or modified the file contents").
- **☐ TEAM:** confirm how the intro film was made (which tools), and add any other AI tools teammates used (images, text, music). Do not list tools that were not used.

No generated content modifies NASA logos, branding or official visual material. The NASA SVS videos are shown unchanged (only re-encoded to a smaller size) and credited.

Suggested wording: *"We used AI tools as assistants: Anthropic Claude (Claude Code) for programming and documentation support, Google Gemini to generate Luna's answers in the app, and the open Kokoro-82M model for Luna's voice. [Add any other tools.] All data shown and sonified comes from the cited datasets; AI is never used to generate measurements."*

## E. NASA data and resources used (genuinely incorporated)

| Resource | How it is used | Link |
|---|---|---|
| NASA POWER (daily and monthly API): T2M, PRECTOTCORR, ALLSKY_SFC_SW_DWN | Earth's Pulse sound, graph and lab starting values (3 places, 2015–2024) | https://power.larc.nasa.gov/ |
| MODIS Terra MOD13Q1.061 NDVI/EVI (via ORNL DAAC MODIS web service; also the team's Google Earth Engine export) | Forest Voices sound, graph, lab | https://lpdaac.usgs.gov/products/mod13q1v061/ · https://modis.ornl.gov/ |
| NASA GISTEMP v4 (team file `GLB.Ts+dSST.csv`) | Earth's Pulse "Whole planet" track | https://data.giss.nasa.gov/gistemp/ |
| NASA GIBS imagery: Blue Marble, VIIRS Black Marble, MUR SST, MODIS NDVI and MERRA-2 T2M snapshots | globe textures and maps (visual only) | https://nasa-gibs.github.io/gibs-api-docs/ |
| NASA SVS / Earth Information Center videos 5101 (MUR SST), 5544 (NRT NDVI), 4285 (GPM IMERG) | mission context videos (not synchronised) | https://svs.gsfc.nasa.gov/5101/ · https://svs.gsfc.nasa.gov/5544/ · https://svs.gsfc.nasa.gov/4285/ |
| NASA SVS EIC still images 5101, 5176, 4950, 5544, 5149, 5147 | "A real NASA picture" cards | https://svs.gsfc.nasa.gov/gallery/earth-information-center/ |

Not used for the sound: NASA/JPL MUR SST point data. It needs an Earthdata token, so the ocean sound uses NOAA data. MUR appears only as imagery and video.

## F. Space Agency partner data and other resources

- **Other agency data (not NASA):**
  - NOAA Coral Reef Watch CoralTemp v3.1 (ocean sound): https://coralreefwatch.noaa.gov/product/5km/index_5km_sst.php
  - NOAA OISST v2.1, inside the team's ocean CSV (lab starting values): https://www.ncei.noaa.gov/products/optimum-interpolation-sst
- **Copernicus Marine Service** (inside the team's ocean CSV: ocean colour, salinity, waves, physics): https://marine.copernicus.eu/. Copernicus is an EU programme. **☐ TEAM:** check whether the challenge counts it as Space Agency Partner data before listing it there; otherwise list it under "other resources".
- **Software and libraries:**
  - three.js (MIT);
  - Vite, TypeScript, Vitest;
  - FastAPI, uvicorn, python-dotenv, google-genai;
  - kokoro-onnx, ONNX Runtime;
  - Kokoro-82M model and voices (Apache-2.0): https://huggingface.co/hexgrad/Kokoro-82M
- **SuperCollider:** the team's own instrument scripts and design, ported to the browser: https://supercollider.github.io/
- **Fonts:** Fredoka and Nunito (SIL Open Font License), bundled.
- **Audio:** all sound is synthesised from the data in the browser (Web Audio). No recordings, no third-party audio and no background music are played. The team's four WAV recordings in `supercollider/cultural_sound/` are kept in the repository but are not used in the app.
- **Intro film:** the team's (see D).
- **Icons:** emoji and hand-drawn inline SVG; no icon libraries.

## Checklist

- [ ] Deploy backend (Hugging Face Space) and frontend (GitHub Pages); paste the public URL (`deploy/DEPLOYMENT.md`).
- [ ] Test the public URL on a phone and a laptop without logging in.
- [ ] Record the 30-second video or make ≤ 7 slides (B). No minors' names, voices or likenesses.
- [ ] Confirm the intro film's production details and AI tools (D).
- [ ] Confirm the licence or ownership of the intro film (F). The WAV samples are no longer played.
- [ ] Decide where Copernicus Marine is listed (F).
- [ ] Paste the summary (A), details (C), AI disclosure (D) and data lists (E, F) into the submission form.
- [ ] Keep `.env` and the Gemini key out of everything (already git-ignored; the key is only a host secret).
