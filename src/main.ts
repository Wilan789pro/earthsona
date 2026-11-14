import "./styles.css";
import { Globe } from "./globe";
import { ALL_LAYERS, SonificationEngine, renderFramesToWav, type LayerToggles } from "./audio/engine";
import { AMBIENCE, NATURE_RULES, ambienceFor } from "./audio/ambience";
import { FramePlayer } from "./audio/player";
import { SeriesChart, renderTable } from "./ui/chart";
import { fmtDate, fmtValue } from "./ui/format";
import { $, announce, esc, fmtClock, loadPref, notice, savePref, setupTabs } from "./ui/dom";
import { DataRegistry, getTrack, type Track } from "./data/registry";
import { EXPERIENCES, IMAGERY, customRegion, getExperience, getRegion } from "./data/regions";
import { loadEicFrames, type EicFrame } from "./data/eic";
import { CRW_REFERENCE, MOD13Q1_REFERENCE, MUR_REFERENCE, POWER_REFERENCE, SVS_REFERENCE, TESVIS_REFERENCE, dataTypeFor } from "./data/parsers.js";
import type { CleanPoint } from "./data/normalise";
import type { CleanSeries, ExperienceId, RegionDef, SoundRole } from "./data/types";
import { trackToFrames, type PitchScale, type SoundFrame } from "./sonification/frames";
import { LIMITATIONS, ROLE_DOCS, SCALES, VARIABLE_WORDS, densityHits, harmonyIntervals, noteFrequency, noteIndex, noteName } from "./sonification/mappings";
import { PALETTES, type PaletteId } from "./sonification/palettes";
import { KID, timeWindows, type TimeWindow } from "./ui/kid";
import { TIPS } from "./ui/narrator";
import { Luna, LunaVoice, bubbleList } from "./ui/luna";
import { runIntro } from "./ui/intro";
import { FOREST_DATA, ForestVoices } from "./ui/forestVoices";
import type { SampleName } from "./audio/cultural";
import { MISSIONS, badgeCount, emptyProgress, loadProgress, saveProgress, type Progress } from "./ui/missions";
import { renderImpact } from "./ui/impact";
import { Story } from "./ui/story";
import { Playground } from "./ui/playground";
import { THEME_SIZE, loadThemeLayers, paintClouds, paintTheme, type Pretend } from "./globeThemes";
import { LabScene } from "./lab/scene";
import { VARS } from "./lab/simulation";
import { backendStatus, sendToLuna, type ChatContext } from "./ui/lunaChat";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const COLORS: Record<ExperienceId, string> = { ocean: "#2b9bf4", forest: "#2fb35e", pulse: "#ff9f1c" };
const WORLD_NAME: Record<ExperienceId, string> = { ocean: "Ocean Symphony", forest: "Forest Voices", pulse: "Earth's Pulse" };
const WORLD_SUB: Record<ExperienceId, string> = { ocean: "How warm is the sea?", forest: "How green is the land?", pulse: "Rain, sun and warmth" };
/** The team's SuperCollider samples (cultural_sound/) used as each place's cultural layer. */
const CULTURAL: Record<string, SampleName> = { "mauritius-waters": "ocean", "black-river-gorges": "forest", "port-louis": "triangle", kyoto: "pulse" };

interface Settings { live: boolean; loop: boolean; textScale: number; nature: boolean; music: boolean; voice: boolean; voiceName: string; photo: boolean }
const settings = loadPref<Settings>("settings3", { live: false, loop: false, textScale: 1, nature: true, music: true, voice: true, voiceName: "", photo: false });
const saveSettings = () => savePref("settings3", settings);

const state = {
  experience: "ocean" as ExperienceId,
  region: getRegion("mauritius-waters") as RegionDef,
  periodIndex: 0,
  window: "all",
  pitchScale: "relative" as PitchScale,
  layers: { ...ALL_LAYERS } as LayerToggles,
  /** Only REAL layers. Simulated fallbacks are dropped: EARTHSONA never plays invented measurements. */
  track: null as Track | null,
  missing: [] as string[],
  allFrames: [] as SoundFrame[],
  frames: [] as SoundFrame[],
  windows: [] as TimeWindow[],
  chartVar: "",
  token: 0,
  eic: [] as EicFrame[],
  eicIndex: 0,
  soundOn: false,
  /** Highest frame index heard in this play-through (for "did they listen?"). */
  heard: 0,
};

const registry = new DataRegistry();
const engine = new SonificationEngine();
const player = new FramePlayer();
const chart = new SeriesChart($("chart"));
const globe = new Globe($("globe"));
const voice = new LunaVoice();
voice.enabled = settings.voice;
voice.chosen = settings.voiceName;
const luna = new Luna(voice);
let progress: Progress = loadProgress();
const saveProg = () => (saveProgress(progress), updateBadgeCount());

const palette = (): PaletteId => (state.region.music === "sega" ? "sega" : "neutral");
const culturalSample = (): SampleName | null => (settings.music ? CULTURAL[state.region.id] ?? null : null);
const renderOpts = () => ({ experience: state.experience, palette: palette(), layers: state.layers, cultural: culturalSample() });
const placeShort = (r: RegionDef) => r.short ?? r.name.split(",")[0];
const pitchSeries = () => state.track?.layers.find((l) => l.def.roles.includes("pitch"))?.result.series ?? null;

// ---------------------------------------------------------------------------
// Worlds and places
// ---------------------------------------------------------------------------
const WORLD_ICON: Record<ExperienceId, string> = {
  ocean: `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M3 22c5-5 9 5 14 0s9 5 14 0 6 3 6 3v10H3Z" fill="#2b9bf4" stroke="#1d3557" stroke-width="2.5" stroke-linejoin="round"/><path d="M6 14c4-4 7 3 11 0" fill="none" stroke="#1d3557" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  forest: `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4 9 20h6L7 31h26l-8-11h6Z" fill="#3cc46b" stroke="#1d3557" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 31v6" stroke="#1d3557" stroke-width="3" stroke-linecap="round"/></svg>`,
  pulse: `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="15" cy="15" r="8" fill="#ffd23f" stroke="#1d3557" stroke-width="2.5"/><path d="M14 34h17a6 6 0 0 0 0-12 8 8 0 0 0-15-1 6 6 0 0 0-2 13Z" fill="#fff" stroke="#1d3557" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
};

function renderExperiences() {
  const box = $("experience-list");
  box.innerHTML = "";
  EXPERIENCES.forEach((e, i) => {
    const b = document.createElement("button");
    b.className = `world w-${e.id}`;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(e.id === state.experience));
    b.tabIndex = e.id === state.experience ? 0 : -1;
    b.innerHTML = `<span class="world-art" aria-hidden="true">${WORLD_ICON[e.id]}</span><span class="world-text"><strong>${WORLD_NAME[e.id]}</strong><small>${WORLD_SUB[e.id]}</small></span><span class="sr-only"> (key ${i + 1})</span>`;
    b.onclick = () => selectExperience(e.id);
    b.onkeydown = (ev) => {
      if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(ev.key)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const n = EXPERIENCES[(i + (ev.key === "ArrowDown" || ev.key === "ArrowRight" ? 1 : EXPERIENCES.length - 1)) % EXPERIENCES.length];
      selectExperience(n.id);
      (box.children[EXPERIENCES.indexOf(n)] as HTMLElement).focus();
    };
    box.appendChild(b);
  });
}

async function bundledFor(exp: ExperienceId, regionId: string) {
  const m = await registry.loadManifest();
  return m?.series.filter((s) => s.experience === exp && s.regionId === regionId) ?? [];
}

function musicTag(r: RegionDef): string {
  if (CULTURAL[r.id] && r.music === "sega") return "Our Sega sounds 🎵";
  if (CULTURAL[r.id]) return "Our team's sound 🎵";
  return r.music === "sega" ? "Sega-inspired music" : "Nature + music";
}

async function renderPlaces() {
  const exp = getExperience(state.experience);
  const list = $("place-list");
  const items = await Promise.all(
    exp.regions.map(async (id) => {
      const r = getRegion(id)!;
      const bundled = await bundledFor(exp.id, id);
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.className = "place";
      if (state.region.id === id) b.setAttribute("aria-current", "true");
      b.innerHTML =
        `<strong>${esc(placeShort(r))}</strong><span class="place-full">${esc(r.name)}</span>` +
        `<span class="tag${r.music === "sega" ? " sega" : ""}">${esc(musicTag(r))}</span>` +
        (bundled.length ? "" : `<span class="tag warn">No data yet</span>`);
      b.onclick = () => selectRegion(r);
      li.appendChild(b);
      return li;
    }),
  );
  list.replaceChildren(...items);
  globe.setMarkers(exp.regions.map((id) => ({ id, lat: getRegion(id)!.lat, lon: getRegion(id)!.lon })), COLORS[exp.id]);
}

function selectExperience(id: ExperienceId): Promise<void> | void {
  if (id === state.experience) return;
  state.experience = id;
  state.periodIndex = 0;
  state.window = "all";
  const exp = getExperience(id);
  if (!("custom" in state.region) && !exp.regions.includes(state.region.id)) state.region = getRegion(exp.regions[0])!;
  document.body.dataset.exp = id;
  renderExperiences();
  renderPlaces();
  updateMix();
  applyGlobeLook();
  renderEic();
  flyToRegion();
  forestVoices.stop(false);
  showForestVoices();
  return loadTrack("world");
}

function selectRegion(r: RegionDef): Promise<void> | void {
  if (r.id === state.region.id && state.track) return;
  state.region = r;
  state.window = "all";
  flyToRegion();
  renderPlaces();
  updateMix();
  return loadTrack("place");
}

function flyToRegion() {
  globe.flyTo(state.region.lat, state.region.lon);
  globe.setLabel(placeShort(state.region), state.region.lat, state.region.lon);
}

function cycleRegion(dir: 1 | -1) {
  const ids = getExperience(state.experience).regions;
  const i = ids.indexOf(state.region.id);
  selectRegion(getRegion(ids[(i + dir + ids.length) % ids.length])!);
}

// ---------------------------------------------------------------------------
// Globe look: each world shows its own NASA map; Luna's pretend changes repaint it
// ---------------------------------------------------------------------------
const themeCanvas = document.createElement("canvas");
const cloudCanvas = document.createElement("canvas");
themeCanvas.width = cloudCanvas.width = THEME_SIZE.W;
themeCanvas.height = cloudCanvas.height = THEME_SIZE.H;
const LEGEND: Record<ExperienceId, string> = {
  ocean: `<span class="key" style="--k:#7ad6ff"></span> shallow sea <span class="key" style="--k:#0a3c96"></span> deep sea`,
  forest: `<span class="key" style="--k:#1f8a3a"></span> very green <span class="key" style="--k:#b5e07a"></span> a little green <span class="key" style="--k:#e9dcc4"></span> few plants`,
  pulse: `<span class="key" style="--k:#e8553d"></span> hot <span class="key" style="--k:#ffe08a"></span> mild <span class="key" style="--k:#5b4fa8"></span> cold`,
};
const MAP_CREDIT: Record<ExperienceId, string> = {
  ocean: "Sea depth from NASA Blue Marble (bathymetry); sea area from NASA/JPL MUR, July 2024.",
  forest: "Greenness from NASA MODIS NDVI, July 2024.",
  pulse: "Air temperature from NASA MERRA-2, July 2024.",
};

async function applyGlobeLook(pretend: Pretend | null = null, rain?: number, sun?: number) {
  const exp = state.experience;
  if (settings.photo) {
    globe.setTheme(null);
    globe.setClouds(null);
    globe.setSunlight(1);
    $("legend").innerHTML = "";
    $("stage-caption").textContent = `NASA Blue Marble photo of Earth (GIBS). Drag to turn the Earth; tap a dot to visit a place.`;
    return;
  }
  const layers = await loadThemeLayers(`${import.meta.env.BASE_URL}textures/`, { ocean: IMAGERY.overlays.ocean.file, forest: IMAGERY.overlays.forest.file, pulse: IMAGERY.overlays.pulse.file });
  if (exp !== state.experience) return;
  if (!layers) {
    globe.setTheme(null);
    $("stage-caption").textContent = "The world maps could not be loaded; showing the NASA photo instead.";
    return;
  }
  const g = themeCanvas.getContext("2d")!;
  const img = g.createImageData(THEME_SIZE.W, THEME_SIZE.H);
  paintTheme(layers, exp, pretend ?? {}, img);
  g.putImageData(img, 0, 0);
  globe.setTheme(themeCanvas);
  if (exp === "pulse" && rain !== undefined && rain > 1) {
    const c = cloudCanvas.getContext("2d")!;
    const ci = c.createImageData(THEME_SIZE.W, THEME_SIZE.H);
    paintClouds(ci, Math.min(1, (rain - 1) / 2) * 0.85 + 0.15);
    c.putImageData(ci, 0, 0);
    globe.setClouds(cloudCanvas);
  } else globe.setClouds(null);
  globe.setSunlight(exp === "pulse" && sun !== undefined ? 0.4 + sun * 0.6 : 1);
  const pretending = !!pretend || (rain !== undefined && rain !== 1) || (sun !== undefined && sun !== 1);
  $("legend").innerHTML = pretending ? `<strong>Pretend Earth</strong> · ${LEGEND[exp]}` : LEGEND[exp];
  $("stage-caption").textContent = `${MAP_CREDIT[exp]} Drag to turn the Earth; tap a dot to visit a place.`;
}

// ---------------------------------------------------------------------------
// Load the data for the current world / place / period
// ---------------------------------------------------------------------------
async function loadTrack(reason: "world" | "place" | "period" | "boot") {
  const token = ++state.token;
  const exp = getExperience(state.experience);
  const period = exp.periods[state.periodIndex] ?? exp.periods[0];
  renderStoryHead();
  const t = await getTrack(registry, { experience: exp.id, region: state.region, period, mode: "auto", live: settings.live });
  if (token !== state.token) return;

  const real = t.layers.filter((l) => l.result.origin !== "simulated");
  state.missing = t.layers.filter((l) => l.result.origin === "simulated").map((l) => l.result.series.label);
  const hasPitch = real.some((l) => l.def.roles.includes("pitch"));
  state.track = hasPitch ? { ...t, layers: real, notices: [] } : null;
  if (!state.track && "custom" in state.region && !settings.live) notice("There is no downloaded data for this point. Grown-ups can turn on “Use live data” in Settings.");
  else if (state.missing.length && state.track) notice(`Not available here: ${state.missing.join(", ")}. Nothing is made up.`);

  state.chartVar = state.track?.layers[0].def.variable ?? "";
  rebuildFrames(false);
  renderStory();
  renderScience();
  updateMix();
  playground.refresh();
  if (state.soundOn) {
    engine.resetNature();
    engine.startNature(ambienceFor(state.region.ambience));
  }
  if (reason === "world") lunaWorld();
  else if (reason === "place" || reason === "period") lunaPlace(reason);
  announce(`${WORLD_NAME[exp.id]}, ${state.region.name}. Press Space to play.`);
}

function rebuildFrames(keepPosition: boolean) {
  state.allFrames = state.track ? trackToFrames(state.track, state.pitchScale) : [];
  const axis = (state.track?.layers[0].result.series.points ?? []) as CleanPoint[];
  state.windows = timeWindows(axis.map((p) => p.time));
  if (!state.windows.some((w) => w.key === state.window)) state.window = "all";
  const w = state.windows.find((x) => x.key === state.window)!;
  const sel = state.allFrames.filter((f) => !w || (f.time >= w.from && f.time <= w.to));
  state.frames = sel.map((f, i) => ({ ...f, index: i, pan: sel.length > 1 ? (i / (sel.length - 1)) * 2 - 1 : 0 }));
  player.load(state.frames, keepPosition);
  const pr = $<HTMLInputElement>("progress");
  pr.max = String(Math.max(0, state.frames.length - 1));
  pr.disabled = state.frames.length === 0;
  updateProgress(player.index);
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------
function sourceChip() {
  const t = state.track;
  if (!t) return { cls: "none", text: "No real data here yet" };
  const kinds = new Set(t.layers.map((l) => l.result.series.source.kind));
  const org = kinds.has("nasa") && kinds.has("noaa") ? "NASA + NOAA" : kinds.has("noaa") ? "NOAA" : "NASA";
  return { cls: "real", text: `Real ${org} data · where it comes from` };
}

function renderStoryHead() {
  $("player-title").textContent = `${WORLD_NAME[state.experience]} · ${placeShort(state.region)}`;
}

function renderStory() {
  const c = sourceChip();
  const chip = $<HTMLButtonElement>("source-badge");
  chip.textContent = c.text;
  chip.disabled = c.cls === "none";
  renderTimeChips();
  updateNow(state.frames[Math.min(player.index, state.frames.length - 1)]);
  $("player-title").textContent = `${WORLD_NAME[state.experience]} · ${placeShort(state.region)}${state.track ? ` · ${currentWindow().label}` : ""}`;
}

function currentWindow(): TimeWindow {
  return state.windows.find((w) => w.key === state.window) ?? { key: "all", label: state.track?.period.label ?? "", from: "", to: "" };
}

function renderTimeChips() {
  const exp = getExperience(state.experience);
  $("years-wrap").hidden = !state.track;
  const pbox = $("period-chips");
  pbox.hidden = exp.periods.length < 2;
  pbox.innerHTML = exp.periods
    .map((p, i) => `<button class="chip period" role="radio" aria-checked="${i === state.periodIndex}" data-period="${i}">${esc(KID.periodLabel(p.key, p.label))}</button>`)
    .join("");
  pbox.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((b) => (b.onclick = () => selectPeriod(+b.dataset.period!)));
  const box = $("year-chips");
  box.innerHTML = state.windows.map((w) => `<button class="chip" role="radio" aria-checked="${w.key === state.window}" data-window="${esc(w.key)}">${esc(w.label)}</button>`).join("");
  box.querySelectorAll<HTMLButtonElement>("[data-window]").forEach((b) => (b.onclick = () => selectWindow(b.dataset.window!)));
}

function selectWindow(key: string) {
  if (key === state.window) return;
  state.window = key;
  const wasPlaying = player.playing;
  rebuildFrames(false);
  renderStory();
  renderChart();
  renderUnderstand();
  if (wasPlaying) player.play();
  lunaTime();
  announce(`Time: ${currentWindow().label}.`);
}

function selectPeriod(i: number) {
  if (i === state.periodIndex) return;
  state.periodIndex = i;
  state.window = "all";
  loadTrack("period");
}

/** The big "now" readout: one value, its date and what you hear, in plain words. */
function updateNow(f: SoundFrame | undefined) {
  const t = state.track;
  const list = $("hear-list");
  if (!t) {
    $("now-label").textContent = "Nature sounds only";
    $("now-value").textContent = "—";
    $("now-date").textContent = "No real measurements here yet.";
    list.innerHTML = "";
    return;
  }
  const pitch = pitchSeries()!;
  $("now-label").textContent = KID.label(pitch.variable);
  if (!f) {
    $("now-value").textContent = "▶";
    $("now-date").textContent = "Press play to hear it";
    list.innerHTML = "";
    return;
  }
  const v = f.values[pitch.variable];
  $("now-value").textContent = v?.value === null || v === undefined ? "no data" : fmtValue(v.value, pitch.unit);
  $("now-date").textContent = fmtDate(f.time, pitch, true) + (v?.quality === "cloudy" ? " · hidden by clouds" : v?.quality === "snow" ? " · snow or ice" : "");
  const items: string[] = [];
  if (f.pitch !== null) items.push(f.pitch > 0.66 ? "high notes" : f.pitch < 0.33 ? "low notes" : "middle notes");
  else items.push("a soft tick: no measurement");
  if (f.harmony) items.push(KID.harmony(harmonyIntervals(f.harmony).label));
  if (f.density !== null) items.push(`${densityHits(f.density)} rain beat${densityHits(f.density) === 1 ? "" : "s"}`);
  if (f.brightness !== null) items.push(`${f.brightness > 0.6 ? "bright" : f.brightness < 0.3 ? "soft" : "warm"} sound`);
  list.innerHTML = items.map((x) => `<li>${esc(x)}</li>`).join("");
}

// ---------------------------------------------------------------------------
// Luna's guidance (she speaks each step; the words are always in her bubble)
// ---------------------------------------------------------------------------
function facts(w: TimeWindow): { hi?: string; lo?: string } {
  const s = pitchSeries();
  if (!s) return {};
  const pts = (s.points as CleanPoint[]).filter((p) => (w.key === "all" || (p.time >= w.from && p.time <= w.to)) && p.value !== null && !p.bridged);
  if (!pts.length) return {};
  const max = pts.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
  const min = pts.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a));
  const say = (p: CleanPoint) => `${fmtValue(p.value as number, s.unit)} in ${fmtDate(p.time, s, false)}`;
  return { hi: say(max), lo: say(min) };
}
const HI_LO: Record<ExperienceId, [string, string]> = { ocean: ["warmest sea", "coolest"], forest: ["greenest", "least green"], pulse: ["warmest air", "coldest"] };

function lunaWorld() {
  if (state.experience === "forest" && FOREST_DATA.observations.length)
    luna.say(`${MISSIONS.forest.lines[0]} We also have our very own forest data from Mauritius. Press Listen in Forest Voices to hear it!`, { mood: "curious" });
  else luna.say(MISSIONS[state.experience].lines[0], { mood: "curious" });
  $("places-h").classList.add("nudge");
  setTimeout(() => $("places-h").classList.remove("nudge"), 2400);
}

function lunaPlace(reason: "place" | "period" = "place") {
  const r = state.region;
  const m = MISSIONS[state.experience];
  if (!state.track) {
    luna.say(`${r.kidIntro ?? r.name} There are no measurements here yet, so you'll hear just the nature sounds.`, { mood: "concerned", actions: [{ label: "▶ Play", primary: true, onClick: () => play() }] });
    return;
  }
  const intro = reason === "period" ? `Now we're listening to ${KID.periodLabel(getExperience(state.experience).periods[state.periodIndex].key, "a new time").toLowerCase()}.` : r.kidIntro ?? "";
  luna.say(`${intro} ${m.lines[2]}`.trim(), {
    mood: "curious",
    actions: [
      { label: "▶ Play", primary: true, onClick: () => play() },
      { label: "Tell me more", onClick: () => lunaTip() },
    ],
  });
  $("btn-play").classList.add("nudge");
  setTimeout(() => $("btn-play").classList.remove("nudge"), 2600);
}

function lunaTime() {
  const w = currentWindow();
  const f = facts(w);
  const [hi, lo] = HI_LO[state.experience];
  if (!f.hi) {
    luna.say(`In ${w.label}, clouds got in the way, so there's not much to hear.`, { mood: "concerned" });
    return;
  }
  luna.say(`${w.key === "all" ? "Over all the years" : `In ${w.label}`}, the ${hi} was ${f.hi}, and the ${lo} was ${f.lo}. Press play to hear it!`, {
    mood: "surprised",
    actions: [{ label: "▶ Play", primary: true, onClick: () => play() }],
  });
}

let tipIndex = -1;
function lunaTip() {
  const tips = TIPS[state.experience];
  tipIndex = (tipIndex + 1) % tips.length;
  luna.say(tips[tipIndex], { mood: "thoughtful", actions: [{ label: "Another one", onClick: () => lunaTip() }, { label: "▶ Play", primary: true, onClick: () => play() }] });
}

function lunaListening() {
  const exp = state.experience;
  const sega = state.region.music === "sega";
  const line = state.track
    ? {
        ocean: "Listen! The waves set the scene, and the tune is made from real sea temperatures. Warmer sea, higher notes!",
        forest: "Listen! The birds and the tune both come from real greenness. Greener forest, more birds and higher notes!",
        pulse: "Listen! Warm air makes high notes, rain makes busy beats and heavy rain sounds, and sunshine makes it bright.",
      }[exp] + (sega ? " The drums are inspired by Sega music from Mauritius." : "")
    : "Listen to the nature sounds of this place. There are no measurements here yet, so there's no tune.";
  luna.say(line, { mood: "happy", actions: [{ label: "Why does it sound like this?", onClick: () => lunaWhy() }] });
}

function lunaWhy() {
  const exp = state.experience;
  const r = state.region;
  const pitch = pitchSeries();
  const items = [
    `Nature: ${AMBIENCE[ambienceFor(r.ambience)].title.toLowerCase()}, made by the computer. ${NATURE_RULES[exp]}`,
    CULTURAL[r.id]
      ? "Music: our team's own recorded sounds (made in SuperCollider), played higher or lower by the measurements, with a tune made from the data."
      : r.music === "sega"
      ? "Music: an original tune inspired by Sega from Mauritius (a ravanne-like drum, maravanne-like shaker and triangle). Its melody comes from the measurements."
      : "Music: a gentle tune whose melody comes from the measurements." + (r.musicStatus === "pending" ? " We haven't added music from this place's own culture yet: we want to make it with local musicians." : ""),
    pitch ? `The measurements: ${KID.label(pitch.variable).toLowerCase()} from ${pitch.source.kind === "noaa" ? "NOAA" : "NASA"}. ${dataTypeFor(pitch.variable, pitch.source.name).kid}` : "There are no measurements here yet.",
  ];
  luna.say(
    {
      ocean: "Everything you hear is shaped by real sea temperatures: the waves and the music!",
      forest: "Everything you hear is shaped by how green the land really was: the birds and the music!",
      pulse: "Everything you hear is shaped by the real temperature, rain and sunshine: the rain sounds and the music!",
    }[exp],
    {
      mood: "thoughtful",
      extra: bubbleList(items) + `<p class="small muted">These sounds are made by EARTHSONA from the numbers. They are not recordings from space.</p>`,
      actions: [{ label: "Show me the science", onClick: () => openGrownups("tab-science") }],
    },
  );
}

/** After listening: what we found, then Luna's question. */
function lunaFinished() {
  const exp = state.experience;
  const f = facts(currentWindow());
  const [hi, lo] = HI_LO[exp];
  const found = f.hi ? `Wow! The ${hi} here was ${f.hi}, and the ${lo} was ${f.lo}.` : "That was lovely!";
  if (progress[exp].badge) {
    luna.say(`${found} You already have the ${MISSIONS[exp].badge} badge.`, { mood: "proud", actions: afterBadgeActions() });
    return;
  }
  const c = MISSIONS[exp].challenge;
  const choices = () => c.options.map((o) => ({ label: o.t, onClick: () => answer(o) }));
  const answer = (o: { ok: boolean; why: string }) => {
    if (!o.ok) {
      luna.say(o.why, { mood: "encouraging", actions: choices() });
      return;
    }
    const mp = progress[exp];
    mp.done[5] = true;
    mp.done[6] = true;
    mp.badge = true;
    saveProg();
    celebrate();
    luna.say(`${o.why} You earned the ${MISSIONS[exp].badge} badge!`, {
      mood: "proud",
      extra: `<p class="small"><strong>${esc(MISSIONS[exp].lines[6])}</strong></p>` + bubbleList(MISSIONS[exp].actions),
      actions: afterBadgeActions(),
    });
  };
  luna.say(`${found} ${MISSIONS[exp].lines[5]} ${c.q}`, { mood: "surprised", actions: choices() });
}

function afterBadgeActions() {
  const next = EXPERIENCES.find((e) => !progress[e.id].badge && e.id !== state.experience);
  return [
    { label: "Why does it matter?", primary: true, onClick: () => openImpact() },
    { label: "Play with Luna", onClick: () => (stopAll(), playground.show()) },
    ...(next ? [{ label: `Go to the ${WORLD_NAME[next.id].toLowerCase()}`, onClick: () => void selectExperience(next.id) }] : [{ label: "See my badges", onClick: () => story.open("finale") }]),
  ];
}

function celebrate() {
  const b = $("btn-badges");
  b.classList.remove("cheer");
  void b.offsetWidth;
  b.classList.add("cheer");
}

// ---------------------------------------------------------------------------
// EIC visual (a real NASA picture of the same topic)
// ---------------------------------------------------------------------------
async function renderEic() {
  const id = state.experience;
  const frames = await loadEicFrames(id, { tryLive: settings.live });
  if (id !== state.experience) return;
  state.eic = frames;
  state.eicIndex = 0;
  showEicFrame();
}

function showEicFrame() {
  const fig = $("eic");
  const frame = state.eic[state.eicIndex];
  if (!frame) {
    fig.hidden = true;
    return;
  }
  fig.hidden = false;
  const img = $<HTMLImageElement>("eic-img");
  const off = $("eic-offline");
  img.removeAttribute("src");
  img.hidden = true;
  off.hidden = false;
  off.textContent = `Loading NASA picture… ${frame.altText}`;
  img.alt = frame.altText;
  img.onload = () => ((img.hidden = false), (off.hidden = true));
  img.onerror = () => ((img.hidden = true), (off.hidden = false), (off.textContent = `Picture unavailable offline. ${frame.altText}`));
  img.src = frame.imageUrl;
  $("eic-gallery").textContent = "A real NASA picture (Earth Information Center)";
  $("eic-title").textContent = frame.title;
  $("eic-relation").textContent = frame.relation ?? "";
  const date = frame.updated ?? frame.released;
  const d = date ? new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  $("eic-meta").innerHTML =
    `${frame.dataset ? `Dataset: ${esc(frame.dataset)} · ` : ""}NASA SVS #${frame.svsId}${d ? ` (${frame.updated ? "updated" : "released"} ${esc(d)})` : ""} · ` +
    `<a href="${esc(frame.pageUrl)}" target="_blank" rel="noopener">open on svs.gsfc.nasa.gov</a>`;
  const nav = $("eic-nav");
  nav.innerHTML = state.eic.length > 1 ? `<button class="pill small" id="eic-next">Next picture (${state.eicIndex + 1} of ${state.eic.length})</button>` : "";
  const next = document.getElementById("eic-next");
  if (next) next.onclick = () => ((state.eicIndex = (state.eicIndex + 1) % state.eic.length), showEicFrame(), $("eic-next").focus());
}

// ---------------------------------------------------------------------------
// Grown-ups: the science behind the sound
// ---------------------------------------------------------------------------
function renderScience() {
  const t = state.track;
  const exp = getExperience(state.experience);
  $("exp-tagline").textContent = `${exp.title} · ${state.region.name}`;
  $("listen-place").textContent = t ? `${t.period.label} · ${state.region.lat}°, ${state.region.lon}°` : "";
  const per = $<HTMLSelectElement>("period");
  per.innerHTML = exp.periods.map((p, i) => `<option value="${i}" ${i === state.periodIndex ? "selected" : ""}>${esc(p.label)}</option>`).join("");
  $("data-types").innerHTML = t
    ? t.layers
        .map((l) => {
          const dt = dataTypeFor(l.def.variable, l.result.series.source.name);
          return `<li><strong>${esc(l.result.series.label)}</strong>: <span class="kind-tag ${dt.kind}">${esc(dt.label)}</span><br/><span class="small">${esc(dt.detail)}</span></li>`;
        })
        .join("")
    : `<li>No real measurements are loaded for this place.</li>`;
  const cl = $<HTMLSelectElement>("chart-layer");
  cl.innerHTML = (t?.layers ?? []).map((l) => `<option value="${l.def.variable}" ${l.def.variable === state.chartVar ? "selected" : ""}>${esc(l.result.series.label)}</option>`).join("");
  renderChart();
  renderMappingTable();
  renderLayersExplain();
  renderLayerToggles();
  renderUnderstand();
  updateNowPlaying(state.frames[Math.min(player.index, state.frames.length - 1)]);
}

function seriesFor(variable: string): CleanSeries | null {
  return state.track?.layers.find((l) => l.def.variable === variable)?.result.series ?? null;
}

function windowed(s: CleanSeries): CleanSeries {
  const w = currentWindow();
  if (w.key === "all") return s;
  return { ...s, points: s.points.filter((p) => p.time >= w.from && p.time <= w.to) } as CleanSeries;
}

function renderChart() {
  const host = $("chart");
  if (!state.track) {
    host.innerHTML = "";
    $("chart-title").textContent = "";
    $("data-table").innerHTML = "";
    return;
  }
  const s = windowed(seriesFor(state.chartVar) ?? state.track.layers[0].result.series);
  $("chart-title").textContent = `${s.label} (${s.unit})`;
  chart.render(s, COLORS[state.experience]);
  $("data-table").innerHTML = renderTable(s);
  const f = state.frames[player.index];
  if (f && (player.playing || player.index > 0)) chart.setPlayheadTime(f.time);
  else chart.hidePlayhead();
}

function rolesHere(): { role: SoundRole; series: CleanSeries }[] {
  const out: { role: SoundRole; series: CleanSeries }[] = [];
  for (const l of state.track?.layers ?? []) for (const r of l.def.roles) out.push({ role: r, series: l.result.series });
  return out;
}

function renderMappingTable() {
  const pal = PALETTES[palette()];
  const rows = rolesHere().map(({ role, series }) => {
    const doc = ROLE_DOCS[role];
    const instrument = pal.instruments.find((i) => i.role.startsWith(role === "pitch" ? "pitch" : role === "density" ? "rhythmic" : role))?.name ?? "";
    const extra = role === "pitch" ? ` Scale: ${SCALES[state.experience].name}; ${state.pitchScale === "absolute" ? "global fixed range" : "this place's own min–max"}.` : "";
    return `<tr><th scope="row">${esc(series.label)}<br/><span class="muted small">${esc(series.unit)}</span></th><td><strong>${esc(doc.youHear)}</strong><br/><span class="small">${esc(doc.rule + extra)}</span>${instrument ? `<br/><span class="muted small">Instrument: ${esc(instrument)}</span>` : ""}</td></tr>`;
  });
  rows.push(`<tr><th scope="row">Nature sound</th><td><span class="small">${esc(NATURE_RULES[state.experience])} Absolute values are used, so the same number always sounds the same.</span></td></tr>`);
  if (palette() === "sega") rows.push(`<tr><th scope="row">Sega-inspired arrangement</th><td><span class="small">${esc(pal.arrangement)} ${state.experience === "forest" ? "In the forest it is reduced to soft wooden taps." : ""} The drum pattern itself does not carry data; the melody it accompanies does.</span></td></tr>`);
  rows.push(`<tr><th scope="row">No data</th><td><span class="small">A soft, dull tick with the melody silent. Nothing is invented for missing or cloudy dates.</span></td></tr>`);
  $("mapping-table").innerHTML = `<thead><tr><th scope="col">Data</th><th scope="col">What you hear</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}

function renderLayersExplain() {
  const amb = AMBIENCE[ambienceFor(state.region.ambience)];
  const r = state.region;
  const regional =
    r.music === "sega"
      ? `${esc(PALETTES.sega.description)} ${esc(PALETTES.sega.disclaimer ?? "")} References: ${PALETTES.sega.references.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label.split(" — ")[0])}</a>`).join(", ")}.`
      : esc(r.musicNote ?? "A neutral palette: no regional identity is assigned to this place.");
  $("layers-explain").innerHTML = `
    <dl class="kv">
      <dt>Nature</dt><dd><strong>${esc(amb.title)}</strong>: ${esc(amb.sounds.join(", "))}. Synthesised in the browser (no recordings). Shaped by the data: ${esc(NATURE_RULES[state.experience])}</dd>
      <dt>Music</dt><dd>The melody, harmony, rhythm and brightness come from the measurements (table above). Regional identity: ${regional}</dd>
    </dl>
    <p class="small muted">These are artistic sound interpretations generated from environmental observations. They are not sounds recorded by satellites.</p>`;
}

function renderLayerToggles() {
  const fs = $("layer-toggles");
  const present = new Set(rolesHere().map((r) => r.role));
  const opts: [keyof LayerToggles, string, boolean][] = [
    ["melody", "Melody", present.has("pitch")],
    ["harmony", "Harmony", present.has("harmony")],
    ["rhythm", "Rhythm", present.has("density")],
    ["brightness", "Brightness", present.has("brightness")],
    ["texture", "Pad", present.has("texture")],
  ];
  fs.hidden = !state.track;
  fs.innerHTML = `<legend>Fine control of the music</legend>` + opts.filter(([, , show]) => show).map(([k, label]) => `<label><input type="checkbox" data-layer="${k}" ${state.layers[k] ? "checked" : ""}/> ${label}</label>`).join("");
  fs.querySelectorAll<HTMLInputElement>("input").forEach((i) => i.addEventListener("change", () => (state.layers[i.dataset.layer as keyof LayerToggles] = i.checked)));
}

function updateNowPlaying(f: SoundFrame | undefined) {
  const box = $("now-playing");
  if (!f || !state.track) {
    box.innerHTML = `<div class="np-row"><span class="k">${state.track ? "Press play" : "No data loaded"}</span></div>`;
    return;
  }
  const rows = [`<div class="np-row"><span class="k">Date</span><strong>${esc(fmtDate(f.time, state.track.layers[0].result.series, true))}</strong></div>`];
  for (const l of state.track.layers) {
    const v = f.values[l.def.variable];
    const q = v?.quality && !["good", "simulated"].includes(v.quality) ? ` (${v.quality})` : "";
    rows.push(`<div class="np-row"><span class="k">${esc(l.result.series.label)}</span><span>${v?.value === null || v === undefined ? `no data${q}` : esc(fmtValue(v.value, l.result.series.unit)) + q}</span></div>`);
  }
  if (f.pitch !== null) {
    const freq = noteFrequency(state.experience, noteIndex(f.pitch));
    const parts = [`note ${noteName(freq)}`];
    if (f.density !== null) parts.push(`${densityHits(f.density)} rhythm hits`);
    if (f.harmony) parts.push(harmonyIntervals(f.harmony).label);
    rows.push(`<div class="np-row"><span class="k">Sound</span><span>${esc(parts.join(" · "))}</span></div>`);
  } else rows.push(`<div class="np-row"><span class="k">Sound</span><span>no-data tick</span></div>`);
  box.innerHTML = rows.join("");
}

function renderUnderstand() {
  const t = state.track;
  if (!t) {
    $("understand-text").innerHTML = `<p>Only the nature soundscape plays: there are no real measurements for this place to turn into sound.</p>`;
    return;
  }
  const out: string[] = [];
  const pitch = windowed(pitchSeries() ?? t.layers[0].result.series);
  const pts = pitch.points as CleanPoint[];
  if (!pts.length) return;
  const d = (p: { time: string }) => esc(fmtDate(p.time, pitch, true));
  const f = (s: CleanSeries, v: number) => `<strong>${esc(fmtValue(v, s.unit))}</strong>`;
  const unit = t.period.label.includes("daily") ? "days" : t.period.label.includes("monthly") ? "months" : "time steps";
  out.push(`<p>Your child heard <strong>${pts.length} ${unit}</strong> at ${esc(state.region.name)}, from ${d(pts[0])} (left ear) to ${d(pts[pts.length - 1])} (right ear).</p><ul>`);
  for (const l of t.layers) {
    const s = windowed(l.result.series);
    const vals = (s.points as CleanPoint[]).filter((p) => p.value !== null);
    if (!vals.length) continue;
    const min = vals.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a));
    const max = vals.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
    const mean = vals.reduce((a, b) => a + (b.value as number), 0) / vals.length;
    const w = VARIABLE_WORDS[s.variable] ?? { short: s.label, more: "higher", less: "lower" };
    for (const role of l.def.roles) {
      const doc = ROLE_DOCS[role];
      out.push(`<li><strong>${esc(doc.youHear)}</strong> followed ${esc(w.short)}: ${role === "pitch" ? `highest note at ${f(s, max.value as number)} (${d(max)}), lowest at ${f(s, min.value as number)} (${d(min)}); average ${f(s, mean)}.` : `values from ${f(s, min.value as number)} to ${f(s, max.value as number)} (average ${f(s, mean)}); ${esc(w.more)} → ${role === "density" ? "busier rhythm" : role === "brightness" ? "brighter sound" : role === "texture" ? "fuller pad" : "different harmony"}.`}</li>`);
    }
    const gaps = s.points.filter((p) => p.value === null).length;
    if (gaps) out.push(`<li>${gaps} date${gaps > 1 ? "s" : ""} of ${esc(w.short)} had no usable data (missing, cloudy or snow): a soft tick.</li>`);
  }
  out.push("</ul>");
  out.push(`<p>Weather, seasons and longer trends are mixed together in these values, so a difference between two times is not, on its own, evidence of climate change, and EARTHSONA does not say what caused it.</p>`);
  out.push(`<p><strong>Limits:</strong> ${t.layers.map((l) => esc(LIMITATIONS[l.def.variable] ?? "")).filter(Boolean).join(" ")}</p>`);
  $("understand-text").innerHTML = out.join("");
}

function renderSourceDetails() {
  const t = state.track;
  if (!t) return;
  $("source-details").innerHTML = t.layers
    .map(({ def, result }) => {
      const s = result.series;
      const src = s.source;
      const pts = s.points;
      const dt = dataTypeFor(s.variable, src.name);
      const from = { bundled: "Bundled file shipped with the app (downloaded with npm run fetch-data)", live: "Live request from your browser this session", simulated: "—" }[result.origin];
      const url = src.url ? src.url.split(/\s{2,}/) : [];
      const rows: [string, string][] = [
        ["Organisation", src.kind === "noaa" ? "NOAA (U.S. National Oceanic and Atmospheric Administration)" : "NASA"],
        ["Kind of data", `<span class="kind-tag ${dt.kind}">${esc(dt.label)}</span> ${esc(dt.detail)}`],
        ["Dataset", esc(s.dataset ?? src.name)],
        ["Source", esc(src.name)],
        ...(src.product ? ([["Product / QA", esc(src.product)]] as [string, string][]) : []),
        ["Variable", `<code>${esc(s.variable)}</code> · ${esc(s.unit)} · sound role: ${def.roles.join(", ")}`],
        ["Place", `${esc(s.region.name)} (${s.region.lat}, ${s.region.lon})`],
        ["Period", `${esc(fmtDate(pts[0].time, s, true))} – ${esc(fmtDate(pts[pts.length - 1].time, s, true))} · ${pts.length} points, ${s.stats.gaps} without data`],
        ["Loaded from", from],
        ...(url[0] ? ([["Request URL", `<a href="${esc(url[0])}" target="_blank" rel="noopener"><code>${esc(url[0])}</code></a>${url[1] ? ` <span class="muted">${esc(url[1])}</span>` : ""}`]] as [string, string][]) : []),
        ...(src.retrievedAt ? ([["Retrieved", esc(new Date(src.retrievedAt).toUTCString())]] as [string, string][]) : []),
        ["Citation", esc(src.citation)],
      ];
      return `<section class="source-layer"><h3>${esc(s.label)}</h3><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></section>`;
    })
    .join("");
}

function renderAbout() {
  const sega = PALETTES.sega;
  const places = EXPERIENCES.map((e) => `<li><strong>${esc(MISSIONS[e.id].title)}</strong>: ${e.regions.map((id) => { const r = getRegion(id)!; return `${esc(r.name)} (${esc(musicTag(r))})`; }).join("; ")}</li>`).join("");
  $("about-body").innerHTML = `
  <p><strong>EARTHSONA — Hear the Earth. Understand the Change.</strong> NASA Space Apps 2026, <em>The Earth Information Jukebox</em>.
  Children explore the planet with Luna, the Moon. Each place has a synthesised nature soundscape and a tune, and <strong>both are shaped by real environmental measurements</strong>.</p>
  <p>The sounds are <strong>artistic interpretations generated from environmental observations</strong>. They are not sounds recorded by satellites.</p>
  <h3>The nine places</h3><ul>${places}</ul>
  <h3>How the sound works</h3>
  <ul>
    <li><strong>Nature</strong>: waves, wind, rain, birds, insects, thunder, ice, synthesised in the browser (no recordings). ${esc(NATURE_RULES.ocean)} ${esc(NATURE_RULES.forest)} ${esc(NATURE_RULES.pulse)}</li>
    <li><strong>Music</strong>: melody, harmony, rhythm and brightness follow documented rules (Science tab). For the three Mauritius places the instruments and arrangement are an original Sega-inspired homage; elsewhere a neutral palette is used.</li>
    <li>Missing, cloudy or snowy dates are a soft tick; nothing is invented.</li>
  </ul>
  <h3>The globe</h3>
  <p>Each world shows its own NASA map: sea depth (Blue Marble bathymetry, masked to the sea with the MUR SST map), vegetation greenness (MODIS NDVI) or air temperature (MERRA-2). In Luna's playground the map is repainted to show a <em>pretend</em> change; it is labelled “Pretend Earth” and is never presented as data.</p>
  <h3>Data sources</h3>
  <div class="table-scroll flat"><table class="sources">
    <thead><tr><th scope="col">World</th><th scope="col">Dataset</th><th scope="col">Kind of data</th></tr></thead>
    <tbody>
      <tr><td>Ocean</td><td>NASA/JPL MUR SST v4.1 and anomaly (preferred: PO.DAAC with an Earthdata token, or ERDDAP). If unavailable when data is downloaded, NOAA Coral Reef Watch CoralTemp v3.1, labelled as NOAA.</td><td>Analysis (Level 4)</td></tr>
      <tr><td>Forest</td><td>MODIS MOD13Q1.061 Terra NDVI + EVI, 250 m, 16-day, with pixel-reliability QA (ORNL DAAC)</td><td>Satellite-derived index</td></tr>
      <tr><td>Weather</td><td>NASA POWER daily and monthly: T2M, PRECTOTCORR, ALLSKY_SFC_SW_DWN</td><td>Model-based estimates (MERRA-2); solar satellite-derived (CERES)</td></tr>
      <tr><td>Globe</td><td>NASA GIBS: Blue Marble (relief + bathymetry), MUR SST, MODIS NDVI, MERRA-2 T2M snapshots</td><td>Imagery (visual only)</td></tr>
      <tr><td>Pictures</td><td>NASA Earth Information Center visualisations (NASA SVS)</td><td>Visual only, not sonified</td></tr>
    </tbody></table></div>
  <p>NDVI and EVI measure how green vegetation looks. They do not count trees or prove deforestation.</p>
  <h3>Citations</h3>
  <p class="cite"><strong>NASA POWER.</strong> ${esc(POWER_REFERENCE)}</p>
  <p class="cite"><strong>MODIS.</strong> ${esc(MOD13Q1_REFERENCE)} ${esc(TESVIS_REFERENCE)}</p>
  <p class="cite"><strong>MUR SST.</strong> ${esc(MUR_REFERENCE)}</p>
  <p class="cite"><strong>NOAA Coral Reef Watch</strong> (only if used). ${esc(CRW_REFERENCE)}</p>
  <p class="cite"><strong>Imagery.</strong> We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS). ${esc(SVS_REFERENCE)}</p>
  <h3>Regional music: ${esc(sega.name)}</h3>
  <p>${esc(sega.description)} ${esc(sega.arrangement)}</p>
  <p>${esc(sega.disclaimer ?? "")}</p>
  <ul>${sega.references.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join("")}</ul>
  <p>Hawaiʻi, the Amazon and Japan have rich musical traditions. EARTHSONA does not add music for them yet: that needs research and collaboration with musicians from those communities, with proper credit. The open Pacific, the boreal forest and Antarctica have no regional music by design.</p>
  <h3>Luna's voice</h3>
  <p>Luna uses the speech voices built into this device. Nothing is recorded or sent anywhere.</p>`;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
function updateProgress(i: number) {
  const pr = $<HTMLInputElement>("progress");
  const n = state.frames.length;
  const idx = Math.min(i, Math.max(0, n - 1));
  pr.value = String(idx);
  const f = state.frames[idx];
  const label = f && state.track ? fmtDate(f.time, state.track.layers[0].result.series, true) : state.track ? "—" : "No data to play";
  pr.setAttribute("aria-valuetext", n ? `${label}, step ${idx + 1} of ${n}` : "no data");
  $("player-date").textContent = label;
  $("player-time").textContent = `${fmtClock(Math.min(i, n) * player.stepSec)} / ${fmtClock(player.durationSec)}`;
}

player.onStep((i, f) => {
  engine.play(f, player.stepSec, renderOpts());
  state.heard = Math.max(state.heard, i);
  chart.setPlayheadTime(f.time);
  updateProgress(i);
  updateNow(f);
  updateNowPlaying(f);
});

player.onState((s) => {
  if (s === "stopped" && player.index >= state.frames.length && state.frames.length) {
    stopAll();
    progress[state.experience].done[2] = true;
    saveProg();
    lunaFinished();
    return;
  }
  if (s === "stopped") chart.hidePlayhead();
  setPlayingUi();
});

function setPlayingUi() {
  const on = state.soundOn;
  document.body.classList.toggle("playing", on);
  $("play-icon").setAttribute("href", on ? "#i-pause" : "#i-play");
  $("btn-play").setAttribute("aria-label", on ? "Pause (Space)" : "Play (Space)");
  $("audio-status").textContent = on ? (player.playing ? "PLAYING" : "NATURE ONLY") : player.index > 0 && player.index < state.frames.length ? "PAUSED" : "STOPPED";
}

async function play() {
  playground.stop();
  await engine.start();
  const fresh = player.index === 0;
  state.soundOn = true;
  engine.resetNature();
  engine.startNature(ambienceFor(state.region.ambience));
  if (state.frames.length) player.play();
  setPlayingUi();
  if (fresh) {
    state.heard = 0;
    lunaListening();
  }
}
function pause() {
  state.soundOn = false;
  player.pause();
  engine.stopNature();
  setPlayingUi();
}
function stopAll() {
  state.soundOn = false;
  if (player.playing || player.index < state.frames.length) player.stop();
  engine.stopNature();
  setPlayingUi();
  updateProgress(0);
}
async function togglePlay() {
  if (state.soundOn) pause();
  else await play();
}

function updateMix() {
  const set = (id: string, on: boolean, title: string) => {
    const b = $<HTMLButtonElement>(id);
    b.setAttribute("aria-pressed", String(on));
    b.title = title;
  };
  const sega = state.region.music === "sega";
  set("mix-nature", settings.nature, "Nature sounds (shaped by the data)");
  set("mix-music", settings.music, state.track ? "The tune made from the data" : "No data here, so no tune");
  $("mix-music-label").textContent = sega ? "Sega music" : "Music";
  engine.setBus("nature", settings.nature);
  engine.setBus("data", settings.music);
  engine.setBus("regional", settings.music && sega);
}

function toggleBus(which: "nature" | "music") {
  settings[which] = !settings[which];
  saveSettings();
  updateMix();
  announce(`${which === "nature" ? "Nature sounds" : "Music"} ${settings[which] ? "on" : "off"}`);
}

async function exportWav() {
  if (!state.frames.length) return;
  const btn = $<HTMLButtonElement>("btn-wav");
  btn.disabled = true;
  try {
    const blob = await renderFramesToWav(state.frames, player.stepSec, renderOpts());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `earthsona-${state.experience}-${state.region.id}-${state.track?.period.key}-${state.window}-${palette()}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Story, playground, impact, grown-ups
// ---------------------------------------------------------------------------
const story = new Story({
  progress: () => progress,
  save: saveProg,
  voice,
  start: () => {
    voice.unlocked = true;
    luna.say("Hooray, you're here! Pick a mission: Ocean Symphony, Forest Voices or Earth's Pulse. I'll show you each one on the Earth!", { mood: "happy" });
    document.querySelector<HTMLElement>("#experience-list [aria-checked='true']")?.focus();
  },
});

const playground = new Playground({
  state: () => ({ experience: state.experience, region: state.region, track: state.track, palette: palette(), layers: state.layers }),
  luna,
  engine,
  pretendGlobe: (p, rain, sun) => void applyGlobeLook(p, rain, sun),
  showScene: (visual, instant) => showScene(visual, instant),
  askLuna: (message) => void askLuna(message),
  beforePlay: async () => {
    player.pause();
    await engine.start();
    state.soundOn = false;
    setPlayingUi();
    engine.startNature(ambienceFor(state.region.ambience));
  },
  afterPlay: () => {
    engine.stopNature();
    engine.resetNature();
  },
  onClose: () => {
    luna.say("Back to the real Earth! Everything on the globe is real NASA data again.", { mood: "happy" });
    $("places-h").focus();
  },
});

// ---------------------------------------------------------------------------
// Lab environment scene (simulation) in the stage
// ---------------------------------------------------------------------------
const labScene = new LabScene($<HTMLCanvasElement>("scene"));
function showScene(visual: Record<string, number> | null, instant = false) {
  const canvas = $("scene");
  if (!visual) {
    canvas.hidden = true;
    labScene.stop();
    $("globe").style.visibility = "";
    $("legend").hidden = false;
    return;
  }
  canvas.hidden = false;
  $("globe").style.visibility = "hidden";
  $("legend").hidden = true;
  labScene.set(state.experience, visual, instant);
  labScene.start();
}

// ---------------------------------------------------------------------------
// Conversation with Luna (Gemini via the EARTHSONA backend)
// ---------------------------------------------------------------------------
let backend = { online: false, chat: false, tts: false } as Awaited<ReturnType<typeof backendStatus>>;

/** Structured, compact description of what the app shows right now. Luna never has to guess. */
function buildContext(): ChatContext {
  const ctx: ChatContext = { mission: state.experience, place: state.region.name };
  const pitch = pitchSeries();
  if (pitch && state.track) {
    const ok = (pitch.points as CleanPoint[]).filter((p) => p.value !== null && !p.bridged);
    const last = ok[ok.length - 1];
    const max = ok.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a), ok[0]);
    const min = ok.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a), ok[0]);
    const kind = dataTypeFor(pitch.variable, pitch.source.name);
    const f = state.frames[Math.min(player.index, state.frames.length - 1)];
    ctx.dataset = {
      variable: pitch.variable,
      label: pitch.label,
      unit: pitch.unit,
      dataset: pitch.dataset ?? pitch.source.name,
      organisation: pitch.source.kind === "noaa" ? "NOAA" : "NASA",
      kind_of_data: kind.label,
      period: state.track.period.label,
      latest: last ? { value: last.value, date: last.time } : null,
      highest: max ? { value: max.value, date: max.time } : null,
      lowest: min ? { value: min.value, date: min.time } : null,
      now_playing: state.soundOn && f ? { value: f.values[pitch.variable]?.value ?? null, date: f.time } : null,
      other_layers: state.track.layers.filter((l) => l.result.series !== pitch).map((l) => l.result.series.label),
    };
  }
  const snap = playground.snapshot();
  if (snap) {
    ctx.experiment = `${MISSIONS[snap.mission].title} laboratory (simplified educational simulation)`;
    ctx.sliders = Object.fromEntries(VARS[snap.mission].map((d) => [d.label, { value: +snap.values[d.key].toFixed(2), baseline: d.baseline, unit: d.unit, min: d.min, max: d.max }]));
    ctx.simulation = {
      ecosystem_health: snap.result.health,
      baseline_health: snap.baselineResult.health,
      indicators: Object.fromEntries(snap.result.indicators.map((i) => [i.label, { value: +i.value.toFixed(2), baseline: +(snap.baselineResult.indicators.find((b) => b.key === i.key)?.value ?? 0).toFixed(2), better_when: i.good }])),
      note: "Outputs of EARTHSONA's simplified model, not observations.",
    };
    ctx.observations = snap.result.findings;
  } else {
    ctx.experiment = state.soundOn ? "listening to the sonification" : "exploring the globe";
  }
  return ctx;
}

async function askLuna(message: string) {
  const text = message.trim();
  if (!text) return;
  if (!backend.chat) backend = await backendStatus();
  if (!backend.chat) {
    luna.status(backend.online ? "Luna's AI isn't configured on the server (GEMINI_API_KEY missing)." : "Luna's server isn't running. Start the backend to chat with her (see README).", true);
    return;
  }
  voice.stop();
  luna.thinking(true);
  $("bubble-extra").innerHTML = `<p class="you-asked"><span>You asked</span> ${esc(text)}</p>`;
  const res = await sendToLuna(text, buildContext());
  luna.thinking(false);
  if (res.ok) {
    luna.say(res.reply, { mood: "thoughtful", extra: `<p class="you-asked"><span>You asked</span> ${esc(text)}</p>`, repeat: true });
  } else if (res.kind !== "cancelled") {
    luna.status(res.message, true);
  }
}

$("luna-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("luna-input");
  const v = input.value;
  input.value = "";
  void askLuna(v);
});

// ---------------------------------------------------------------------------
// Forest Voices: the team's Mauritius vegetation CSV through the team's SuperCollider instrument
// ---------------------------------------------------------------------------
const forestVoices = new ForestVoices({
  engine,
  luna,
  beforePlay: async () => {
    playground.stop();
    if (state.soundOn) stopAll();
    await engine.start();
    engine.resetNature();
    engine.startNature("island-forest");
  },
  afterPlay: () => {
    engine.stopNature();
    engine.resetNature();
  },
  showPoint: (lat, lon, label) => {
    globe.flyTo(lat, lon);
    globe.setLabel(label, lat, lon);
  },
});
function showForestVoices() {
  const on = state.experience === "forest";
  $("fv-panel").hidden = !on;
  if (on) forestVoices.render();
}

function togglePlayground() {
  if (playground.open) playground.close();
  else {
    stopAll();
    playground.show();
  }
}

function openImpact() {
  renderImpact({ experience: state.experience, region: state.region, track: state.track, voice });
  ($("dlg-impact") as HTMLDialogElement).showModal();
  progress[state.experience].done[4] = true;
  saveProg();
}

const selectTab = setupTabs(document.querySelector<HTMLElement>("#dlg-grownups [role='tablist']")!);
function openGrownups(tab = "tab-science") {
  selectTab(tab);
  ($("dlg-grownups") as HTMLDialogElement).showModal();
}

function updateBadgeCount() {
  $("badge-count").textContent = String(badgeCount(progress));
}

function renderVoices() {
  const sel = $<HTMLSelectElement>("voice-pick");
  const vs = voice.voices();
  sel.innerHTML = vs.length ? vs.map((v) => `<option value="${esc(v.name)}" ${v.name === voice.voiceName ? "selected" : ""}>${esc(v.name)}</option>`).join("") : `<option>No voices on this device</option>`;
  sel.disabled = !vs.length;
}
voice.onVoices = renderVoices;
voice.onDuck = (d) => engine.setDucked(d);
luna.onVoiceSetting = (on) => {
  settings.voice = on;
  saveSettings();
  $<HTMLInputElement>("set-voice").checked = on;
};

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) => (b.onclick = () => (b.closest("dialog") as HTMLDialogElement).close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => e.target === d && (d as HTMLDialogElement).close()));
$("dlg-impact").addEventListener("close", () => voice.stop());

$("btn-home").onclick = () => story.open("welcome");
story.onReplayIntro = () => playIntro();
$("btn-badges").onclick = () => story.open("finale");
$("btn-grownups").onclick = () => openGrownups();
let helloCount = 0;
$("luna").onclick = () => {
  const lines = [
    "Hi again! I'm right here. Shall we listen to the Earth?",
    "Want to try an experiment? Press Experiment with Luna!",
    "Tip: pick a different year and see if the music changes!",
  ];
  luna.say(lines[helloCount++ % lines.length], {
    mood: helloCount % 2 ? "happy" : "encouraging",
    actions: [
      { label: "▶ Play", primary: true, onClick: () => play() },
      { label: "Experiment", onClick: () => togglePlayground() },
    ],
  });
};
$("btn-lab").onclick = () => togglePlayground();
$("source-badge").onclick = () => (renderSourceDetails(), ($("dlg-source") as HTMLDialogElement).showModal());
$("btn-play").onclick = togglePlay;
$("btn-stop").onclick = () => {
  const listened = state.frames.length > 0 && state.heard >= state.frames.length * 0.3;
  stopAll();
  if (listened) lunaFinished();
};
$("btn-replay").onclick = async () => {
  playground.stop();
  await engine.start();
  state.soundOn = true;
  engine.startNature(ambienceFor(state.region.ambience));
  if (state.frames.length) player.replay();
  setPlayingUi();
};
$("btn-why").onclick = () => lunaWhy();
$("btn-wav").onclick = exportWav;
$("btn-reset").onclick = () => globe.reset();
$("mix-nature").onclick = () => toggleBus("nature");
$("mix-music").onclick = () => toggleBus("music");
$<HTMLSelectElement>("rate").onchange = (e) => {
  player.setRate(+(e.target as HTMLSelectElement).value);
  updateProgress(player.index);
};
$<HTMLInputElement>("volume").oninput = (e) => engine.setVolume(+(e.target as HTMLInputElement).value);
$<HTMLInputElement>("progress").oninput = (e) => {
  const i = +(e.target as HTMLInputElement).value;
  player.seek(i);
  const f = state.frames[i];
  if (f) {
    chart.setPlayheadTime(f.time);
    updateNow(f);
    updateNowPlaying(f);
    updateProgress(i);
  }
};
$<HTMLSelectElement>("period").onchange = (e) => selectPeriod(+(e.target as HTMLSelectElement).value);
$<HTMLSelectElement>("pitch-scale").onchange = (e) => {
  state.pitchScale = (e.target as HTMLSelectElement).value as PitchScale;
  rebuildFrames(true);
  renderMappingTable();
};
$<HTMLSelectElement>("chart-layer").onchange = (e) => ((state.chartVar = (e.target as HTMLSelectElement).value), renderChart());
chart.onSeek = (i) => {
  const time = chart.timeAt(i);
  const idx = state.frames.findIndex((f) => f.time >= (time ?? ""));
  player.seek(Math.max(0, idx));
  if (!state.soundOn) play();
};

const bind = (id: string, key: "live" | "loop" | "voice" | "photo", apply: (v: boolean) => void) => {
  const el = $<HTMLInputElement>(id);
  el.checked = settings[key];
  apply(settings[key]);
  el.onchange = () => {
    settings[key] = el.checked;
    saveSettings();
    apply(el.checked);
  };
};
let booted = false;
bind("set-live", "live", () => booted && loadTrack("period"));
bind("set-loop", "loop", (v) => (player.loop = v));
bind("set-voice", "voice", (v) => booted && luna.setVoiceEnabled(v));
bind("set-photo", "photo", () => booted && applyGlobeLook());
$<HTMLSelectElement>("voice-pick").onchange = (e) => {
  voice.choose((e.target as HTMLSelectElement).value);
  settings.voiceName = voice.voiceName;
  saveSettings();
};
$("voice-test").onclick = () => {
  voice.unlocked = true;
  voice.say("Hi! I'm Luna. Shall we listen to the Earth together?", true);
};
$("btn-reset-progress").onclick = (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  if (!b.dataset.armed) {
    b.dataset.armed = "1";
    b.textContent = "Press again to erase all badges";
    return;
  }
  delete b.dataset.armed;
  b.textContent = "Start over (erase badges)";
  progress = emptyProgress();
  progress.intro = true;
  saveProg();
  announce("Badges erased.");
};

const setText = (s: number) => {
  settings.textScale = Math.min(1.5, Math.max(0.85, Math.round(s * 100) / 100));
  document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  saveSettings();
};
setText(settings.textScale);
$("btn-text-up").onclick = () => setText(settings.textScale + 0.1);
$("btn-text-down").onclick = () => setText(settings.textScale - 0.1);

globe.onImagery = () => void applyGlobeLook();
globe.onPick = (lat, lon) => void (settings.live && selectRegion(customRegion(lat, lon)));
globe.onMarker = (id) => void selectRegion(getRegion(id)!);


// Browsers allow speech only after the first tap or key press. Then Luna reads what she is showing.
const unlock = () => {
  if (voice.unlocked) return;
  voice.unlocked = true;
  setTimeout(() => {
    if (voice.state === "idle" && !story.isOpen && luna.text) voice.say(luna.text);
  }, 400);
};
addEventListener("pointerdown", unlock, { once: true, capture: true });
addEventListener("keydown", unlock, { once: true, capture: true });

addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (e.key === "Escape") {
    voice.stop();
    if (!t.closest("dialog[open]") && playground.open) playground.close();
    return;
  }
  if (t.closest("input, select, textarea, dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
  const onButton = ["BUTTON", "SUMMARY", "A"].includes(t.tagName) || t.getAttribute("role") === "radio";
  switch (e.key) {
    case " ":
      if (onButton) return;
      e.preventDefault();
      togglePlay();
      break;
    case "s": case "S": stopAll(); break;
    case "w": case "W": lunaWhy(); break;
    case "l": case "L": togglePlayground(); break;
    case "n": case "N": toggleBus("nature"); break;
    case "m": case "M": toggleBus("music"); break;
    case "1": case "2": case "3": selectExperience(EXPERIENCES[+e.key - 1].id); break;
    case "[": cycleRegion(-1); break;
    case "]": cycleRegion(1); break;
    case "r": case "R": globe.reset(); break;
    case "+": case "=": globe.zoom(0.9); break;
    case "-": case "_": globe.zoom(1.1); break;
    case "ArrowLeft": if (!onButton) globe.rotate(-0.1, 0); break;
    case "ArrowRight": if (!onButton) globe.rotate(0.1, 0); break;
    case "ArrowUp": if (!onButton) globe.rotate(0, -0.1); break;
    case "ArrowDown": if (!onButton) globe.rotate(0, 0.1); break;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.body.dataset.exp = state.experience;
renderExperiences();
renderPlaces();
renderAbout();
renderEic();
renderVoices();
applyGlobeLook();
flyToRegion();
updateMix();
updateBadgeCount();
showForestVoices();
const playIntro = () => {
  globe.paused = true;
  runIntro(
    () => story.open("welcome"),
    () => (globe.paused = false), // the Earth is already turning when the app grows out of the tablet
  );
};
if (!progress.intro) playIntro();
else luna.say("Welcome back! Pick a mission and a place, press play to hear the real data, tap me to open the lab, or ask me anything below.");
loadTrack("boot");
// Detect Luna's backend; retry a few times (the page can be busy right after loading).
void (async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    backend = await backendStatus();
    if (backend.online) break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  voice.engine = backend.tts ? "kokoro" : "browser";
  renderVoices();
  if (!backend.online) luna.status("Luna's AI server is offline: guided tour only. Start the backend to chat with her.", true);
  else if (!backend.chat) luna.status("Luna's AI isn't configured (GEMINI_API_KEY missing on the server).", true);
})();
booted = true;

// Debug hook for automated checks (no effect on the UI).
(window as unknown as { __earthsona: unknown }).__earthsona = { state, player, registry, engine, settings, voice, luna, playground, progress: () => progress, buildContext, backend: () => backend, forestVoices };
