import "./styles.css";
import { Globe } from "./globe";
import { ALL_LAYERS, SonificationEngine, renderFramesToWav, type Bus, type LayerToggles } from "./audio/engine";
import { AMBIENCE, ambienceFor } from "./audio/ambience";
import { FramePlayer } from "./audio/player";
import { SeriesChart, renderTable } from "./ui/chart";
import { fmtDate, fmtValue } from "./ui/format";
import { $, announce, esc, fmtClock, loadPref, notice, savePref } from "./ui/dom";
import { Narrator } from "./ui/narrator";
import { EarthLab } from "./ui/lab";
import { DataRegistry, getTrack, type Track } from "./data/registry";
import { EXPERIENCES, IMAGERY, REGIONS, customRegion, getExperience, getRegion } from "./data/regions";
import { loadEicFrames, type EicFrame } from "./data/eic";
import { CRW_REFERENCE, MOD13Q1_REFERENCE, MUR_REFERENCE, POWER_REFERENCE, SVS_REFERENCE, TESVIS_REFERENCE, dataTypeFor } from "./data/parsers.js";
import type { CleanPoint } from "./data/normalise";
import type { CleanSeries, ExperienceId, RegionDef, SoundRole } from "./data/types";
import { trackToFrames, type PitchScale, type SoundFrame } from "./sonification/frames";
import { LIMITATIONS, ROLE_DOCS, SCALES, VARIABLE_WORDS, densityHits, harmonyIntervals, noteFrequency, noteIndex, noteName } from "./sonification/mappings";
import { PALETTES, type PaletteId } from "./sonification/palettes";
import { KID, timeWindows, type TimeWindow } from "./ui/kid";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const COLORS: Record<ExperienceId, string> = { ocean: "#38bdf8", forest: "#4ade80", pulse: "#fbbf24" };

interface Settings { live: boolean; loop: boolean; popups: boolean; textScale: number; night: boolean; overlay: boolean; regional: boolean; nature: boolean; data: boolean }
const settings = loadPref<Settings>("settings2", { live: false, loop: false, popups: true, textScale: 1, night: false, overlay: false, regional: true, nature: true, data: true });

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
  /** Sound is on (nature and/or data). The data player may have finished while nature keeps playing. */
  soundOn: false,
};

const registry = new DataRegistry();
const engine = new SonificationEngine();
const player = new FramePlayer();
const chart = new SeriesChart($("chart"));
const globe = new Globe($("globe"));
const narrator = new Narrator();

const palette = (): PaletteId => (state.region.music === "sega" && settings.regional ? "sega" : "neutral");
const renderOpts = () => ({ experience: state.experience, palette: palette(), layers: state.layers });
const placeShort = (r: RegionDef) => r.short ?? r.name.split(",")[0];

// ---------------------------------------------------------------------------
// Left: worlds and places
// ---------------------------------------------------------------------------
function renderExperiences() {
  const box = $("experience-list");
  box.innerHTML = "";
  EXPERIENCES.forEach((e, i) => {
    const b = document.createElement("button");
    b.className = "exp-btn";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(e.id === state.experience));
    b.tabIndex = e.id === state.experience ? 0 : -1;
    b.style.setProperty("--c", COLORS[e.id]);
    b.innerHTML = `<span class="exp-icon" aria-hidden="true">${e.icon}</span><strong>${esc(e.short)}</strong><span class="sub">${esc(e.kid)}<span class="sr-only"> ${esc(e.title)} (key ${i + 1})</span></span>`;
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

function musicTag(r: RegionDef): { cls: string; text: string } {
  if (r.music === "sega") return { cls: "music", text: "🎵 Sega-inspired music" };
  if (r.musicStatus === "pending") return { cls: "nature", text: "🌿 Nature + data · regional music not added yet" };
  return { cls: "nature", text: "🌿 Nature + data only" };
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
      b.className = "place-card";
      if (state.region.id === id) b.setAttribute("aria-current", "true");
      const m = musicTag(r);
      b.innerHTML =
        `<strong>${esc(placeShort(r))}</strong><span class="place-full">${esc(r.name)}</span>` +
        `<span class="tag ${m.cls}">${esc(m.text)}</span>` +
        (bundled.length ? "" : `<span class="tag warn">No real data downloaded yet</span>`);
      b.onclick = () => selectRegion(r);
      li.appendChild(b);
      return li;
    }),
  );
  list.replaceChildren(...items);
  globe.setMarkers(exp.regions.map((id) => ({ id, lat: getRegion(id)!.lat, lon: getRegion(id)!.lon })), COLORS[exp.id]);
}

function selectExperience(id: ExperienceId) {
  if (id === state.experience) return;
  state.experience = id;
  state.periodIndex = 0;
  state.window = "all";
  const exp = getExperience(id);
  if (!("custom" in state.region) && !exp.regions.includes(state.region.id)) state.region = getRegion(exp.regions[0])!;
  document.body.dataset.exp = id;
  narrator.setExperience(id);
  $("tip-subtitle").hidden = true;
  $("tip-play-label").textContent = "Hear a tip";
  renderExperiences();
  renderPlaces();
  applyOverlay();
  renderEic();
  flyToRegion();
  loadTrack("place");
}

function selectRegion(r: RegionDef) {
  if (r.id === state.region.id && state.track) return;
  state.region = r;
  state.window = "all";
  flyToRegion();
  renderPlaces();
  loadTrack("place");
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
// Load all layers for the current world / place / period
// ---------------------------------------------------------------------------
async function loadTrack(reason: "place" | "period" | "boot") {
  const token = ++state.token;
  const exp = getExperience(state.experience);
  const period = exp.periods[state.periodIndex] ?? exp.periods[0];
  renderStoryHead();
  $("understand-text").textContent = "Loading data…";

  const t = await getTrack(registry, { experience: exp.id, region: state.region, period, mode: "auto", live: settings.live });
  if (token !== state.token) return; // superseded by a newer selection

  // Never play invented values: keep only real layers.
  const real = t.layers.filter((l) => l.result.origin !== "simulated");
  state.missing = t.layers.filter((l) => l.result.origin === "simulated").map((l) => l.result.series.label);
  const hasPitch = real.some((l) => l.def.roles.includes("pitch"));
  state.track = hasPitch ? { ...t, layers: real, notices: [] } : null;
  if (!state.track) {
    notice(
      "custom" in state.region && !settings.live
        ? "There is no downloaded data for this point. Turn on “Use live data” in Settings, or pick a listed place. You can still listen to the nature sounds."
        : `No real measurements are available for ${state.region.name} yet, so EARTHSONA plays nature sounds only (it never makes up numbers).`,
    );
  } else if (state.missing.length) {
    notice(`Not available for this place: ${state.missing.join(", ")}. That sound layer is silent; nothing is made up.`);
  }

  state.chartVar = state.track?.layers[0].def.variable ?? "";
  rebuildFrames(false);
  renderStory();
  renderScience();
  updateMix();
  lab.refresh();
  if (state.soundOn) engine.startNature(ambienceFor(state.region.ambience));
  if (reason !== "boot") showDiscovery("place");
  announce(`${exp.short}, ${state.region.name}. ${state.track ? sourceChip().text : "Nature sounds only"}. Press Space to play.`);
}

function rebuildFrames(keepPosition: boolean) {
  state.allFrames = state.track ? trackToFrames(state.track, state.pitchScale) : [];
  const axis = (state.track?.layers[0].result.series.points ?? []) as CleanPoint[];
  state.windows = timeWindows(axis.map((p) => p.time));
  if (!state.windows.some((w) => w.key === state.window)) state.window = "all";
  const w = state.windows.find((x) => x.key === state.window)!;
  const sel = state.allFrames.filter((f) => !w || (f.time >= w.from && f.time <= w.to));
  // Re-index so the stereo sweep and arrangement follow the chosen window.
  state.frames = sel.map((f, i) => ({ ...f, index: i, pan: sel.length > 1 ? (i / (sel.length - 1)) * 2 - 1 : 0 }));
  player.load(state.frames, keepPosition);
  const pr = $<HTMLInputElement>("progress");
  pr.max = String(Math.max(0, state.frames.length - 1));
  pr.disabled = state.frames.length === 0;
  updateProgress(player.index);
}

// ---------------------------------------------------------------------------
// Right: the story card (simple, child-friendly)
// ---------------------------------------------------------------------------
function sourceChip() {
  const t = state.track;
  if (!t) return { cls: "none", text: "No real data here yet", why: "nature sounds only" };
  const kinds = new Set(t.layers.map((l) => l.result.series.source.kind));
  const org = kinds.has("nasa") && kinds.has("noaa") ? "NASA + NOAA" : kinds.has("noaa") ? "NOAA" : "NASA";
  const live = t.layers.some((l) => l.result.origin === "live");
  return { cls: kinds.has("noaa") && !kinds.has("nasa") ? "noaa" : "nasa", text: `Real ${org} data`, why: live ? "loaded live · details" : "where it comes from" };
}

function renderStoryHead() {
  const r = state.region;
  const exp = getExperience(state.experience);
  $("loc-world").textContent = `${exp.icon} ${exp.title}`;
  $("loc-name").textContent = r.name;
  $("loc-intro").textContent = r.kidIntro ?? r.context ?? "";
}

function renderStory() {
  renderStoryHead();
  const c = sourceChip();
  const chip = $("source-badge");
  chip.className = `data-chip ${c.cls}`;
  chip.innerHTML = `<span aria-hidden="true">${c.cls === "none" ? "○" : "◆"}</span> ${esc(c.text)} <span class="why">${esc(c.why)}</span>`;
  chip.setAttribute("aria-label", `${c.text}. ${c.cls === "none" ? "" : "Show where the data comes from."}`);
  (chip as HTMLButtonElement).disabled = c.cls === "none";
  renderTimeChips();
  updateNow(state.frames[Math.min(player.index, state.frames.length - 1)]);
  const exp = getExperience(state.experience);
  $("player-title").textContent = `${exp.icon} ${placeShort(state.region)} · ${state.track ? currentWindow().label : "nature sounds"}`;
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
  showDiscovery("time");
  announce(`Time: ${currentWindow().label}.`);
}

function selectPeriod(i: number) {
  if (i === state.periodIndex) return;
  state.periodIndex = i;
  state.window = "all";
  loadTrack("period");
}

/** The big "now" readout: one value, its date and what you hear — in plain words. */
function updateNow(f: SoundFrame | undefined) {
  const t = state.track;
  const list = $("hear-list");
  if (!t) {
    $("now-label").textContent = "Nature sounds only";
    $("now-value").textContent = "—";
    $("now-date").textContent = "No real measurements to play here.";
    list.innerHTML = "";
    return;
  }
  const pitch = t.layers.find((l) => l.def.roles.includes("pitch"))!.result.series;
  $("now-label").textContent = KID.label(pitch.variable);
  if (!f) {
    $("now-value").textContent = "▶";
    $("now-date").textContent = "Press play to hear the measurements";
    list.innerHTML = "";
    return;
  }
  const v = f.values[pitch.variable];
  $("now-value").textContent = v?.value === null || v === undefined ? "no data" : fmtValue(v.value, pitch.unit);
  $("now-date").textContent = fmtDate(f.time, pitch, true) + (v?.quality === "cloudy" ? " · hidden by clouds" : v?.quality === "snow" ? " · snow or ice" : "");
  const items: string[] = [];
  if (f.pitch !== null) items.push(`🎵 ${f.pitch > 0.66 ? "high" : f.pitch < 0.33 ? "low" : "middle"} note`);
  else items.push("· soft tick: no measurement");
  if (f.harmony) items.push(`🎶 ${KID.harmony(harmonyIntervals(f.harmony).label)}`);
  if (f.density !== null) items.push(`🥁 ${densityHits(f.density)} rain beat${densityHits(f.density) === 1 ? "" : "s"}`);
  if (f.brightness !== null) items.push(`✨ ${f.brightness > 0.6 ? "bright" : f.brightness < 0.3 ? "dull" : "soft"} tone`);
  for (const l of t.layers) {
    if (l.result.series === pitch) continue;
    const x = f.values[l.def.variable];
    if (x?.value !== null && x !== undefined) items.push(`${KID.label(l.def.variable)}: ${fmtValue(x.value, l.result.series.unit)}`);
  }
  list.innerHTML = items.map((x) => `<li>${esc(x)}</li>`).join("");
}

// ---------------------------------------------------------------------------
// Discovery cards
// ---------------------------------------------------------------------------
let discoveryTimer: number | undefined;
function showDiscovery(kind: "place" | "time" | "welcome") {
  if (!settings.popups && kind !== "welcome") return;
  const card = $("discovery");
  const content = kind === "welcome" ? KID.welcome() : KID.discovery(kind, state.experience, state.region, state.track, currentWindow());
  $("disc-kicker").textContent = content.kicker;
  $("disc-title").textContent = content.title;
  $("disc-fact").innerHTML = content.fact;
  $("disc-data").innerHTML = content.data;
  $("disc-sound").innerHTML = content.sound;
  card.hidden = false;
  card.classList.remove("pop");
  void card.offsetWidth;
  card.classList.add("pop");
  clearTimeout(discoveryTimer);
  announce(`${content.title}. ${card.innerText.slice(0, 160)}`);
}
function hideDiscovery() {
  $("discovery").hidden = true;
}

// ---------------------------------------------------------------------------
// EIC visual
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
  off.textContent = `Loading NASA visual… ${frame.altText}`;
  img.alt = frame.altText;
  img.onload = () => ((img.hidden = false), (off.hidden = true));
  img.onerror = () => ((img.hidden = true), (off.hidden = false), (off.textContent = `Image unavailable offline. ${frame.altText}`));
  img.src = frame.imageUrl;
  $("eic-gallery").textContent = `NASA Earth Information Center${frame.gallery && frame.gallery !== "Earth Information Center" ? ` · ${frame.gallery}` : ""}`;
  $("eic-title").textContent = frame.title;
  $("eic-relation").textContent = frame.relation ?? "";
  const date = frame.updated ?? frame.released;
  const d = date ? new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  $("eic-meta").innerHTML =
    `${frame.dataset ? `Dataset: ${esc(frame.dataset)} · ` : ""}Original visualisation: NASA SVS #${frame.svsId}${d ? ` (${frame.updated ? "updated" : "released"} ${esc(d)})` : ""} · ` +
    `<a href="${esc(frame.pageUrl)}" target="_blank" rel="noopener">open on svs.gsfc.nasa.gov</a>`;
  const nav = $("eic-nav");
  nav.innerHTML =
    state.eic.length > 1
      ? `<button class="btn small ghost" id="eic-next">Next NASA visual (${state.eicIndex + 1} of ${state.eic.length})</button>`
      : "";
  const next = document.getElementById("eic-next");
  if (next) next.onclick = () => ((state.eicIndex = (state.eicIndex + 1) % state.eic.length), showEicFrame(), $("eic-next").focus());
}

// ---------------------------------------------------------------------------
// Science behind the sound (all the detail, folded away)
// ---------------------------------------------------------------------------
function renderScience() {
  const t = state.track;
  const exp = getExperience(state.experience);
  $("exp-tagline").textContent = exp.tagline;
  $("listen-place").textContent = t ? `${state.region.name} · ${t.period.label} · ${state.region.lat}°, ${state.region.lon}°` : state.region.name;
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
  if (palette() === "sega") rows.push(`<tr><th scope="row">Regional music</th><td><span class="small">${esc(pal.arrangement)} ${state.experience === "forest" ? "In the forest it is reduced to soft wooden taps." : ""} The drum and taps do <strong>not</strong> carry data.</span></td></tr>`);
  rows.push(`<tr><th scope="row">No data</th><td><span class="small">A soft, dull tick with the melody silent. Nothing is invented for missing or cloudy dates.</span></td></tr>`);
  $("mapping-table").innerHTML = `<thead><tr><th scope="col">Data</th><th scope="col">What you hear</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}

function renderLayersExplain() {
  const amb = AMBIENCE[ambienceFor(state.region.ambience)];
  const r = state.region;
  const regional =
    r.music === "sega"
      ? `${esc(PALETTES.sega.description)} ${esc(PALETTES.sega.disclaimer ?? "")} References: ${PALETTES.sega.references.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label.split(" — ")[0])}</a>`).join(", ")}.`
      : esc(r.musicNote ?? "No regional music for this place.");
  $("layers-explain").innerHTML = `
    <dl class="kv">
      <dt>🌿 Nature</dt><dd><strong>${esc(amb.title)}</strong>: ${esc(amb.sounds.join(", "))}. Synthesised in your browser (no recordings). It sets the scene and does <strong>not</strong> carry data.</dd>
      <dt>📈 Data</dt><dd>Made only from the measurements listed above, using the rules in the table. When the numbers change, this layer changes.</dd>
      <dt>🎵 Music</dt><dd>${regional}</dd>
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
  fs.innerHTML = `<legend>Fine control of data layers</legend>` + opts
    .filter(([, , show]) => show)
    .map(([k, label]) => `<label><input type="checkbox" data-layer="${k}" ${state.layers[k] ? "checked" : ""}/> ${label}</label>`)
    .join("");
  fs.querySelectorAll<HTMLInputElement>("input").forEach((i) =>
    i.addEventListener("change", () => {
      state.layers[i.dataset.layer as keyof LayerToggles] = i.checked;
      announce(`${i.parentElement!.textContent!.trim()} ${i.checked ? "on" : "off"}`);
    }),
  );
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

/** "What you heard": variable, sound, values, meaning, limitations — from the data actually loaded. */
function renderUnderstand() {
  const t = state.track;
  if (!t) {
    $("understand-text").innerHTML = `<p>Only the nature soundscape is playing: there are no real measurements for this place to turn into sound.</p>`;
    return;
  }
  const out: string[] = [];
  const pitch = windowed(t.layers.find((l) => l.def.roles.includes("pitch"))?.result.series ?? t.layers[0].result.series);
  const pts = pitch.points as CleanPoint[];
  if (!pts.length) return;
  const d = (p: { time: string }) => esc(fmtDate(p.time, pitch, true));
  const f = (s: CleanSeries, v: number) => `<strong>${esc(fmtValue(v, s.unit))}</strong>`;
  const unit = t.period.label.includes("daily") ? "days" : t.period.label.includes("monthly") ? "months" : "time steps";
  out.push(`<p>You heard <strong>${pts.length} ${unit}</strong> at ${esc(state.region.name)}, from ${d(pts[0])} (left ear) to ${d(pts[pts.length - 1])} (right ear).</p>`);
  out.push("<ul>");
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
    if (gaps) out.push(`<li>${gaps} date${gaps > 1 ? "s" : ""} of ${esc(w.short)} had no usable data (missing, cloudy or snow): you heard a soft tick.</li>`);
  }
  out.push("</ul>");
  out.push(`<p>Weather, seasons and longer trends are all mixed together in these values, so a difference between two times is not, on its own, evidence of climate change, and EARTHSONA does not say what caused it.</p>`);
  out.push(`<p><strong>Limits:</strong> ${t.layers.map((l) => esc(LIMITATIONS[l.def.variable] ?? "")).filter(Boolean).join(" ")}</p>`);
  if (state.missing.length) out.push(`<p><em>Not available here: ${esc(state.missing.join(", "))}. That layer stayed silent.</em></p>`);
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

// ---------------------------------------------------------------------------
// Player and mix
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
  chart.setPlayheadTime(f.time);
  updateProgress(i);
  updateNow(f);
  updateNowPlaying(f);
});

player.onState((s) => {
  if (s === "stopped" && player.index >= state.frames.length && state.frames.length) {
    announce("Finished. Open “Science behind the sound” to see what you heard.");
    stopAll();
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
  if (on) startVisualizer();
}

async function play() {
  lab.stop();
  await engine.start();
  state.soundOn = true;
  engine.startNature(ambienceFor(state.region.ambience));
  if (state.frames.length) player.play();
  setPlayingUi();
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
  const set = (id: string, on: boolean, disabled = false, title = "") => {
    const b = $<HTMLButtonElement>(id);
    b.setAttribute("aria-pressed", String(on && !disabled));
    b.disabled = disabled;
    b.title = title;
  };
  set("mix-nature", settings.nature, false, "Natural sounds of this place (no data)");
  set("mix-data", settings.data, !state.track, state.track ? "The sound made from real measurements" : "No real measurements here");
  const hasMusic = state.region.music === "sega";
  set("mix-regional", settings.regional, !hasMusic, hasMusic ? "Sega-inspired music for Mauritius (no data)" : state.region.musicNote ?? "No regional music here");
  $("mix-regional-label").textContent = hasMusic ? "Sega music" : "Music: none";
  engine.setBus("nature", settings.nature);
  engine.setBus("data", settings.data);
  engine.setBus("regional", settings.regional && hasMusic);
}

function toggleBus(bus: Bus) {
  const key = bus === "regional" ? "regional" : bus;
  if (bus === "regional" && state.region.music !== "sega") return;
  if (bus === "data" && !state.track) return;
  settings[key] = !settings[key];
  savePref("settings2", settings);
  updateMix();
  if (bus === "regional") {
    renderMappingTable();
    announce(settings.regional ? "Sega-inspired music on. The data mapping is unchanged." : "Regional music off. Data instruments are now plain tones.");
  } else announce(`${bus === "nature" ? "Nature sounds" : "Data sound"} ${settings[key] ? "on" : "off"}`);
}

function startVisualizer() {
  const canvas = $<HTMLCanvasElement>("visualizer");
  const ctx = canvas.getContext("2d")!;
  const an = engine.analyser;
  if (!an) return;
  const data = new Uint8Array(an.fftSize);
  const color = COLORS[state.experience];
  const draw = () => {
    ctx.fillStyle = "rgba(2,6,23,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state.soundOn) return;
    requestAnimationFrame(draw);
    an.getByteTimeDomainData(data);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * canvas.width;
      const y = (data[i] / 255) * canvas.height;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  };
  draw();
}

async function exportWav() {
  if (!state.frames.length) return;
  const btn = $<HTMLButtonElement>("btn-wav");
  btn.disabled = true;
  announce("Rendering WAV file…");
  try {
    const blob = await renderFramesToWav(state.frames, player.stepSec, renderOpts());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `earthsona-${state.experience}-${state.region.id}-${state.track?.period.key}-${state.window}-${palette()}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    announce("WAV file ready.");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Narration (short tips with subtitles)
// ---------------------------------------------------------------------------
narrator.onDuck = (d) => engine.setDucked(d);
narrator.onState = (s, text) => {
  const sub = $("tip-subtitle");
  $("tip-ctls").hidden = s === "idle";
  $("tip-play-label").textContent = s === "idle" ? (narrator.text ? "Next tip" : "Hear a tip") : "Next tip";
  $("tip-pause-icon").setAttribute("href", s === "paused" ? "#i-play" : "#i-pause");
  $("tip-pause-label").textContent = s === "paused" ? "Resume tip" : "Pause tip";
  $("tip-pause").title = s === "paused" ? "Resume tip" : "Pause tip";
  if (text) {
    sub.hidden = false;
    sub.textContent = text + (s !== "idle" && state.soundOn ? "  (soundscape turned down while the tip plays)" : "");
  }
};

// ---------------------------------------------------------------------------
// Globe layers
// ---------------------------------------------------------------------------
function applyOverlay() {
  const ov = IMAGERY.overlays[state.experience];
  globe.setOverlay(settings.overlay ? ov.file : null, (ok) => {
    $("stage-caption").textContent =
      (globe.realImagery
        ? `Imagery: NASA GIBS — ${settings.night ? IMAGERY.night.title : IMAGERY.base.title}`
        : "Globe: stylised placeholder map (NASA imagery not bundled yet)") +
      (settings.overlay ? (ok ? `; data map: ${ov.title}.` : "; data map unavailable offline.") : ".") +
      " Drag to turn the Earth, click a dot to choose a place.";
  });
}

// ---------------------------------------------------------------------------
// Search (OpenStreetMap Nominatim — online only; listed places work offline)
// ---------------------------------------------------------------------------
async function search(q: string) {
  const box = $("search-results");
  if (q.trim().length < 2) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `<p class="muted small">Searching…</p>`;
  const local = REGIONS.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  let remote: { display_name: string; lat: string; lon: string }[] = [];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) remote = await r.json();
  } catch {
    /* offline */
  }
  const items: string[] = [];
  local.forEach((r, i) => items.push(`<li><button data-local="${i}">${esc(r.name)}<span class="sub">Featured place</span></button></li>`));
  remote.forEach((r, i) => items.push(`<li><button data-remote="${i}">${esc(r.display_name.split(",")[0])}<span class="sub">${esc(r.display_name)}</span></button></li>`));
  box.innerHTML = (items.length ? `<ul>${items.join("")}</ul>` : `<p class="muted small">${navigator.onLine ? "No places found." : "Search needs internet. Pick a featured place or click the globe."}</p>`) + `<button class="btn small ghost" id="search-close">Close results</button>`;
  box.querySelectorAll<HTMLButtonElement>("button[data-local]").forEach((b) => (b.onclick = () => {
    box.hidden = true;
    const r = local[+b.dataset.local!];
    const exp = EXPERIENCES.find((e) => e.regions.includes(r.id));
    if (exp && exp.id !== state.experience) {
      state.region = r;
      selectExperience(exp.id);
    } else selectRegion(r);
  }));
  box.querySelectorAll<HTMLButtonElement>("button[data-remote]").forEach((b) => {
    const r = remote[+b.dataset.remote!];
    b.onclick = () => ((box.hidden = true), selectRegion(customRegion(+r.lat, +r.lon, r.display_name.split(",")[0])));
  });
  $("search-close").onclick = () => (box.hidden = true);
  (box.querySelector("button[data-local], button[data-remote]") as HTMLElement | null)?.focus();
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
function renderAbout() {
  const sega = PALETTES.sega;
  const places = EXPERIENCES.map((e) => `<li>${e.icon} <strong>${esc(e.title)}</strong>: ${e.regions.map((id) => { const r = getRegion(id)!; return `${esc(r.name)} (${esc(musicTag(r).text.replace(/^\S+\s/, ""))})`; }).join("; ")}</li>`).join("");
  $("about-body").innerHTML = `
  <p><strong>EARTHSONA — Hear the Earth. Understand the Change.</strong> Built for NASA Space Apps 2026, <em>The Earth Information Jukebox</em>.
  Explore the planet through sound: a natural soundscape for each place, a sound made from real environmental measurements, and regional music where a genuine, researched connection exists.</p>
  <p>The sounds are <strong>artistic interpretations generated from environmental observations</strong>. They are not sounds recorded by satellites.</p>
  <h3>The nine featured experiences</h3>
  <ul>${places}</ul>
  <h3>Three sound layers</h3>
  <ul>
    <li><strong>🌿 Nature</strong>: waves, wind, rain, birds, insects, thunder, ice… synthesised in the browser for each place (no recordings, so nothing needs a licence). It carries no data.</li>
    <li><strong>📈 Data</strong>: made only from measurements, with the documented rules below. Missing or cloudy dates are a soft tick; nothing is invented.</li>
    <li><strong>🎵 Music</strong>: an original, synthesised Sega-inspired arrangement for the three Mauritius places only. It changes instruments and adds a drum or wood taps; it never changes what a value sounds like and carries no data.</li>
  </ul>
  <h3>Data sources</h3>
  <div class="table-scroll flat"><table class="sources">
    <thead><tr><th scope="col">World</th><th scope="col">Dataset</th><th scope="col">Kind of data</th></tr></thead>
    <tbody>
      <tr><td>🌊 Ocean</td><td>NASA/JPL MUR SST v4.1 and its anomaly (preferred), via NOAA ERDDAP. If the MUR server cannot be reached when data is downloaded, NOAA Coral Reef Watch CoralTemp v3.1 SST and anomaly are used instead and labelled as NOAA.</td><td>Analysis (Level 4, gap-free blend of satellite and in-situ data)</td></tr>
      <tr><td>🌳 Forest</td><td>MODIS MOD13Q1.061 Terra NDVI + EVI, 250 m, 16-day, with pixel-reliability QA, via ORNL DAAC</td><td>Satellite-derived index</td></tr>
      <tr><td>💓 Pulse</td><td>NASA POWER (LaRC) daily and monthly: T2M, PRECTOTCORR, ALLSKY_SFC_SW_DWN</td><td>Model-based estimates (MERRA-2) and satellite-derived solar (CERES)</td></tr>
      <tr><td>Globe</td><td>NASA GIBS: Blue Marble; VIIRS Black Marble 2016; data maps (MUR SST, MODIS NDVI, MERRA-2 T2M)</td><td>Imagery (visual only)</td></tr>
      <tr><td>Beside each world</td><td>Official NASA Earth Information Center visualisations (NASA SVS): SST and SST anomaly near real time, GEDI forest height, near real-time NDVI, GEOS-FP precipitation and temperature</td><td>Visual only, not sonified</td></tr>
      <tr><td>Place search</td><td>OpenStreetMap Nominatim (© OpenStreetMap contributors)</td><td>Not NASA; online only</td></tr>
    </tbody></table></div>
  <p>NDVI and EVI measure how green vegetation looks. They do not count trees or prove deforestation; EARTHSONA makes no forest-loss claims.</p>
  <h3>Citations</h3>
  <p class="cite"><strong>NASA POWER.</strong> ${esc(POWER_REFERENCE)}</p>
  <p class="cite"><strong>MODIS.</strong> ${esc(MOD13Q1_REFERENCE)} ${esc(TESVIS_REFERENCE)}</p>
  <p class="cite"><strong>MUR SST.</strong> ${esc(MUR_REFERENCE)}</p>
  <p class="cite"><strong>NOAA Coral Reef Watch</strong> (only if used). ${esc(CRW_REFERENCE)}</p>
  <p class="cite"><strong>Imagery.</strong> We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS). ${esc(SVS_REFERENCE)}</p>
  <h3>How the data sound is made</h3>
  <ul>
    ${(["pitch", "harmony", "density", "brightness", "texture"] as SoundRole[]).map((r) => `<li><strong>${esc(ROLE_DOCS[r].youHear)}</strong>: ${esc(ROLE_DOCS[r].rule)}</li>`).join("")}
  </ul>
  <h3>Regional music: ${esc(sega.name)}</h3>
  <p>${esc(sega.description)} ${esc(sega.arrangement)}</p>
  <p>${esc(sega.disclaimer ?? "")}</p>
  <ul>${sega.references.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join("")}</ul>
  <p>Hawaiʻi, the Amazon and Japan have rich musical traditions. EARTHSONA does not add music for them yet: that needs research and collaboration with musicians from those communities, with proper credit. The open Pacific, the boreal forest and Antarctica have no regional music by design.</p>
  <h3>Earth Sound Lab (✦ Try this out)</h3>
  <p>Compare two real times at the same place and hear the difference. The separate “What if?” mode uses make-believe values, is clearly labelled, changes only the sound and is not a forecast.</p>`;
}

// ---------------------------------------------------------------------------
// Lab
// ---------------------------------------------------------------------------
const lab = new EarthLab(engine, {
  state: () => ({ experience: state.experience, region: state.region, track: state.track, palette: palette(), layers: state.layers }),
  selectExperience,
  selectRegion: (id) => selectRegion(getRegion(id)!),
  beforePlay: async () => {
    player.pause();
    await engine.start();
    state.soundOn = false;
    setPlayingUi();
    engine.startNature(ambienceFor(state.region.ambience));
  },
  afterPlay: () => engine.stopNature(),
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const openDialog = (id: string) => ($(id) as HTMLDialogElement).showModal();
document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) => (b.onclick = () => (b.closest("dialog") as HTMLDialogElement).close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => e.target === d && d.close()));
$("dlg-lab").addEventListener("close", () => lab.stop());

$("source-badge").onclick = () => (renderSourceDetails(), openDialog("dlg-source"));
$("btn-try").onclick = () => (lab.refresh(), openDialog("dlg-lab"));
$("btn-settings").onclick = () => openDialog("dlg-settings");
$("btn-about").onclick = () => openDialog("dlg-about");
$("btn-keys").onclick = () => openDialog("dlg-keys");
$("disc-close").onclick = hideDiscovery;
$("btn-play").onclick = togglePlay;
$("btn-stop").onclick = stopAll;
$("btn-replay").onclick = async () => {
  lab.stop();
  await engine.start();
  state.soundOn = true;
  engine.startNature(ambienceFor(state.region.ambience));
  if (state.frames.length) player.replay();
  setPlayingUi();
};
$("btn-wav").onclick = exportWav;
$("btn-reset").onclick = () => globe.reset();
$("mix-nature").onclick = () => toggleBus("nature");
$("mix-data").onclick = () => toggleBus("data");
$("mix-regional").onclick = () => toggleBus("regional");
$("tip-play").onclick = () => narrator.next();
$("tip-pause").onclick = () => narrator.togglePause();
$("tip-stop").onclick = () => narrator.stop();
$("tip-replay").onclick = () => narrator.replay();
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
  announce(state.pitchScale === "absolute" ? "Global pitch scale: the same value is the same note in every place." : "Relative pitch scale: this place's own range.");
};
$<HTMLSelectElement>("chart-layer").onchange = (e) => ((state.chartVar = (e.target as HTMLSelectElement).value), renderChart());
chart.onSeek = (i) => {
  const time = chart.timeAt(i);
  const idx = state.frames.findIndex((f) => f.time >= (time ?? ""));
  player.seek(Math.max(0, idx));
  if (!state.soundOn) play();
};

const bind = (id: string, key: "live" | "loop" | "popups" | "night" | "overlay", apply: (v: boolean) => void) => {
  const el = $<HTMLInputElement>(id);
  el.checked = settings[key];
  apply(settings[key]);
  el.onchange = () => {
    settings[key] = el.checked;
    savePref("settings2", settings);
    apply(el.checked);
  };
};
let booted = false;
bind("set-live", "live", () => booted && loadTrack("period"));
bind("set-loop", "loop", (v) => (player.loop = v));
bind("set-popups", "popups", (v) => !v && hideDiscovery());
bind("set-night", "night", (v) => {
  globe.setStyle(v ? "night" : "day");
  applyOverlay();
});
bind("set-overlay", "overlay", () => applyOverlay());

const setText = (s: number) => {
  settings.textScale = Math.min(1.5, Math.max(0.85, Math.round(s * 100) / 100));
  document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  savePref("settings2", settings);
};
setText(settings.textScale);
$("btn-text-up").onclick = () => setText(settings.textScale + 0.1);
$("btn-text-down").onclick = () => setText(settings.textScale - 0.1);

let searchTimer: number | undefined;
$("search-form").addEventListener("submit", (e) => (e.preventDefault(), search($<HTMLInputElement>("search-input").value)));
$("search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = (e.target as HTMLInputElement).value;
  if (!v) $("search-results").hidden = true;
  else searchTimer = window.setTimeout(() => search(v), 500);
});

globe.onImagery = () => applyOverlay();
globe.onPick = (lat, lon) => selectRegion(customRegion(lat, lon));
globe.onMarker = (id) => selectRegion(getRegion(id)!);

addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (e.key === "Escape" && !t.closest("dialog[open]")) {
    hideDiscovery();
    narrator.stop();
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
    case "t": case "T": narrator.state === "idle" ? narrator.next() : narrator.stop(); break;
    case "n": case "N": toggleBus("nature"); break;
    case "d": case "D": toggleBus("data"); break;
    case "m": case "M": toggleBus("regional"); break;
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
narrator.setExperience(state.experience);
renderExperiences();
renderPlaces();
renderAbout();
renderEic();
applyOverlay();
flyToRegion();
updateMix();
loadTrack("boot").then(() => {
  if (!loadPref<boolean>("welcomed", false)) {
    showDiscovery("welcome");
    savePref("welcomed", true);
  }
});
booted = true;

// Debug hook for automated checks (no effect on the UI).
(window as unknown as { __earthsona: unknown }).__earthsona = { state, player, registry, engine, narrator, settings };
