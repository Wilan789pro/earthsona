import "./styles.css";
import { Globe } from "./globe";
import { ALL_LAYERS, SonificationEngine, renderFramesToWav, type LayerToggles } from "./audio/engine";
import { FramePlayer } from "./audio/player";
import { SeriesChart, renderTable } from "./ui/chart";
import { fmtDate, fmtValue } from "./ui/format";
import { $, announce, esc, fmtClock, loadPref, notice, savePref, setupTabs } from "./ui/dom";
import { SoundLab } from "./ui/lab";
import { Guide } from "./ui/guide";
import { DataRegistry, getTrack, type Track } from "./data/registry";
import { EXPERIENCES, IMAGERY, REGIONS, customRegion, getExperience, getRegion } from "./data/regions";
import { loadEicFrame } from "./data/eic";
import { MOD13Q1_REFERENCE, MUR_REFERENCE, POWER_REFERENCE, SIMULATED_LABEL, SVS_REFERENCE, TESVIS_REFERENCE } from "./data/parsers.js";
import type { CleanPoint } from "./data/normalise";
import type { CleanSeries, ExperienceId, RegionDef, SoundRole } from "./data/types";
import { trackToFrames, type PitchScale, type SoundFrame } from "./sonification/frames";
import { LIMITATIONS, ROLE_DOCS, SCALES, VARIABLE_WORDS, densityHits, harmonyIntervals, noteFrequency, noteIndex, noteName } from "./sonification/mappings";
import { PALETTES, palettesFor, type PaletteId } from "./sonification/palettes";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const COLORS: Record<ExperienceId, string> = { ocean: "#38bdf8", forest: "#4ade80", pulse: "#fbbf24" };
const ICONS: Record<ExperienceId, string> = { ocean: "🌊", forest: "🌳", pulse: "💓" };

interface Settings { live: boolean; loop: boolean; voice: boolean; textScale: number; night: boolean; overlay: string }
const settings = loadPref<Settings>("settings", { live: false, loop: false, voice: false, textScale: 1, night: false, overlay: "exp" });

const state = {
  experience: "ocean" as ExperienceId,
  region: getRegion("mauritius-waters") as RegionDef,
  periodIndex: 0,
  mode: "auto" as "auto" | "simulated",
  pitchScale: "relative" as PitchScale,
  palette: "neutral" as PaletteId,
  layers: { ...ALL_LAYERS } as LayerToggles,
  track: null as Track | null,
  frames: [] as SoundFrame[],
  chartVar: "",
  token: 0,
};

const registry = new DataRegistry();
const engine = new SonificationEngine();
const player = new FramePlayer();
const chart = new SeriesChart($("chart"));
const globe = new Globe($("globe"));
const showTab = setupTabs($("side-tabs"));

// ---------------------------------------------------------------------------
// Left: experiences and places
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
    b.innerHTML = `<span class="dot" aria-hidden="true"></span><strong>${ICONS[e.id]} ${esc(e.title)}</strong><span class="sub">${esc(e.tagline)}<span class="sr-only"> (key ${i + 1})</span></span>`;
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

async function hasBundled(exp: ExperienceId, regionId: string): Promise<boolean> {
  const m = await registry.loadManifest();
  return Boolean(m?.series.some((s) => s.experience === exp && s.regionId === regionId));
}

async function renderPlaces() {
  const exp = getExperience(state.experience);
  const list = $("place-list");
  list.innerHTML = "";
  for (const id of exp.regions) {
    const r = getRegion(id)!;
    const real = await hasBundled(exp.id, id);
    const li = document.createElement("li");
    const b = document.createElement("button");
    if (state.region.id === id) b.setAttribute("aria-current", "true");
    b.innerHTML = `${esc(r.name)}<span class="tag ${real ? "real" : ""}">${real ? "◆ NASA data bundled" : "◇ simulated until NASA data is fetched"}</span>`;
    b.onclick = () => selectRegion(r);
    li.appendChild(b);
    list.appendChild(li);
  }
  globe.setMarkers(exp.regions.map((id) => ({ id, lat: getRegion(id)!.lat, lon: getRegion(id)!.lon })), COLORS[exp.id]);
}

function selectExperience(id: ExperienceId) {
  if (id === state.experience) return;
  state.experience = id;
  state.periodIndex = 0;
  const exp = getExperience(id);
  if (!("custom" in state.region) && !exp.regions.includes(state.region.id)) state.region = getRegion(exp.regions[0])!;
  document.body.dataset.exp = id;
  renderExperiences();
  renderPlaces();
  applyOverlay();
  renderEic();
  globe.flyTo(state.region.lat, state.region.lon);
  globe.setLabel(state.region.name.split(",")[0], state.region.lat, state.region.lon);
  loadTrack();
}

function selectRegion(r: RegionDef, openListen = false) {
  state.region = r;
  globe.flyTo(r.lat, r.lon);
  globe.setLabel(r.name.split(",")[0], r.lat, r.lon);
  renderPlaces();
  loadTrack();
  // Keep whichever panel the user is on (don't yank them out of Listen mid-playback).
  if (openListen) showTab("tab-listen");
}

function cycleRegion(dir: 1 | -1) {
  const ids = getExperience(state.experience).regions;
  const i = ids.indexOf(state.region.id);
  selectRegion(getRegion(ids[(i + dir + ids.length) % ids.length])!);
}

// ---------------------------------------------------------------------------
// Load all layers for the current experience / place / period, then update everything from it
// ---------------------------------------------------------------------------
async function loadTrack() {
  const token = ++state.token;
  const exp = getExperience(state.experience);
  const period = exp.periods[state.periodIndex] ?? exp.periods[0];
  renderLocation();
  $("understand-text").textContent = "Loading data…";

  const track = await getTrack(registry, { experience: exp.id, region: state.region, period, mode: state.mode, live: settings.live });
  if (token !== state.token) return; // superseded by a newer selection
  state.track = track;
  if (!track.layers.some((l) => l.result.series.experience === exp.id)) return;

  for (const n of track.notices) notice(n);
  if (state.mode === "auto" && "custom" in state.region && !settings.live && track.origin === "simulated") {
    notice("No bundled NASA data for this point. Turn on “Use live NASA data” in Settings to fetch it, or pick a listed place.");
  }

  // Sound palette: keep the regional one only where it is offered.
  const offered = palettesFor(state.region.music);
  if (!offered.some((p) => p.id === state.palette)) state.palette = "neutral";

  state.chartVar = track.layers[0].def.variable;
  rebuildFrames(true);
  renderListen();
  renderAvailability();
  lab.refresh();
  announce(`${exp.title}, ${state.region.name}, ${period.label}. ${badgeInfo(track).text}. Press Space to play.`);
}

function rebuildFrames(keepPosition: boolean) {
  if (!state.track) return;
  state.frames = trackToFrames(state.track, state.pitchScale);
  player.load(state.frames, keepPosition);
  const pr = $<HTMLInputElement>("progress");
  pr.max = String(Math.max(0, state.frames.length - 1));
  updateProgress(player.index);
}

// ---------------------------------------------------------------------------
// Location panel
// ---------------------------------------------------------------------------
function renderLocation() {
  const r = state.region;
  $("loc-country").textContent = r.country ?? (("custom" in r) ? "Selected point" : "");
  $("loc-name").textContent = r.name;
  $("loc-coords").textContent = `${Math.abs(r.lat).toFixed(2)}°${r.lat >= 0 ? "N" : "S"}, ${Math.abs(r.lon).toFixed(2)}°${r.lon >= 0 ? "E" : "W"} · ${r.biome}`;
  $("loc-context").textContent = r.context ?? "";
  const fact = $("loc-fact");
  if (r.fact) {
    fact.hidden = false;
    fact.innerHTML = `${esc(r.fact)} <span class="muted small">Source: <a href="${esc(r.factSource!.url)}" target="_blank" rel="noopener">${esc(r.factSource!.label)}</a></span>`;
  } else fact.hidden = true;
}

async function renderAvailability() {
  const ul = $("loc-availability");
  const m = await registry.loadManifest();
  const rows: string[] = [];
  for (const e of EXPERIENCES) {
    const available = e.regions.includes(state.region.id);
    for (const p of e.periods) {
      const vars = p.layers.map((l) => l.variable);
      const bundled = vars.filter((v) => m?.series.some((s) => s.experience === e.id && s.regionId === state.region.id && s.variable === v && s.periodKey === p.key));
      if (!available && !("custom" in state.region)) continue;
      const tag = bundled.length === vars.length
        ? `<span class="kind-tag nasa">◆ NASA data</span>`
        : bundled.length
          ? `<span class="kind-tag nasa">◆ ${bundled.length}/${vars.length} NASA</span>`
          : settings.live && e.id !== "ocean"
            ? `<span class="kind-tag live">live if online</span>`
            : `<span class="kind-tag sim">◇ simulated</span>`;
      rows.push(`<li><span>${ICONS[e.id]} ${esc(e.title)} · ${esc(p.label)}</span>${tag}</li>`);
    }
  }
  ul.innerHTML = rows.join("") || `<li class="muted">No experience uses this place yet.</li>`;
}

async function renderEic() {
  const id = state.experience;
  const fig = $("eic");
  const frame = await loadEicFrame(id, { tryLive: settings.live });
  if (id !== state.experience) return;
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
  img.onload = () => {
    img.hidden = false;
    off.hidden = true;
  };
  img.onerror = () => {
    img.hidden = true;
    off.hidden = false;
    off.textContent = `Image unavailable (offline?). ${frame.altText}`;
  };
  img.src = frame.imageUrl;
  $("eic-title").textContent = frame.title;
  const date = frame.released ? new Date(frame.released).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  $("eic-meta").innerHTML = `NASA SVS #${frame.svsId}${date ? ` · released ${esc(date)}` : ""} · <a href="${esc(frame.pageUrl)}" target="_blank" rel="noopener">svs.gsfc.nasa.gov</a> · a supporting visual, not the data being played`;
}

// ---------------------------------------------------------------------------
// Listen panel
// ---------------------------------------------------------------------------
function badgeInfo(t: Track) {
  const kinds = new Set(t.layers.map((l) => l.result.series.source.kind));
  if (kinds.size > 1) return { cls: "mixed", icon: "i-flask", text: "Mixed: NASA data + simulated layers", why: "not all layers are observations" };
  if (kinds.has("nasa")) {
    const names = [...new Set(t.layers.map((l) => l.result.series.source.name.replace(" (LaRC)", "")))].join(" + ");
    const live = t.layers.some((l) => l.result.origin === "live");
    return { cls: "nasa", icon: "i-satellite", text: `NASA data: ${names}`, why: live ? "live request" : "bundled observations" };
  }
  return { cls: "sim", icon: "i-flask", text: "Simulated demonstration data", why: "not a NASA observation" };
}

function renderListen() {
  const t = state.track!;
  const exp = getExperience(state.experience);
  $("exp-title").textContent = `${ICONS[exp.id]} ${exp.title}`;
  $("exp-tagline").textContent = exp.tagline;
  $("listen-place").textContent = `${state.region.name} · ${t.period.label}`;

  const b = badgeInfo(t);
  const badge = $("source-badge");
  badge.className = `badge ${b.cls}`;
  badge.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${b.icon}"/></svg><span>${esc(b.text)}<span class="why">${esc(b.why)} · details</span></span>`;
  badge.setAttribute("aria-label", `${b.text}, ${b.why}. Show source details.`);

  const per = $<HTMLSelectElement>("period");
  per.innerHTML = exp.periods.map((p, i) => `<option value="${i}" ${i === state.periodIndex ? "selected" : ""}>${esc(p.label)}</option>`).join("");

  // Sound profiles offered for this place.
  const offered = palettesFor(state.region.music);
  $("palette-options").innerHTML = offered
    .map((p) => `<label><input type="radio" name="palette" value="${p.id}" ${p.id === state.palette ? "checked" : ""}/> <span><strong>${esc(p.name)}</strong><br/><span class="muted small">${esc(p.description)}</span></span></label>`)
    .join("");
  $("palette-options").querySelectorAll<HTMLInputElement>("input").forEach((i) =>
    i.addEventListener("change", () => {
      state.palette = i.value as PaletteId;
      renderPaletteNote();
      renderLayerToggles();
      renderMappingTable();
      announce(`Sound profile: ${PALETTES[state.palette].name}. The data mapping is unchanged.`);
    }),
  );
  renderPaletteNote();

  const cl = $<HTMLSelectElement>("chart-layer");
  cl.innerHTML = t.layers.map((l) => `<option value="${l.def.variable}" ${l.def.variable === state.chartVar ? "selected" : ""}>${esc(l.result.series.label)}</option>`).join("");
  renderChart();
  renderMappingTable();
  renderLayerToggles();
  renderUnderstand();
  updateNowPlaying(state.frames[Math.min(player.index, state.frames.length - 1)]);
  $("player-title").textContent = `${exp.title} · ${state.region.name.split(",")[0]} · ${t.period.label}`;
}

function renderPaletteNote() {
  const p = PALETTES[state.palette];
  const offeredRegional = palettesFor(state.region.music).length > 1;
  $("palette-note").innerHTML =
    (p.disclaimer ? `${esc(p.disclaimer)} ` : "") +
    (p.references.length ? `References: ${p.references.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label.split(" — ")[0])}</a>`).join(", ")}. ` : "") +
    (offeredRegional ? "" : "Regional profiles are offered only for places where the team has researched the music (currently Mauritius).");
}

function seriesFor(variable: string): CleanSeries | null {
  return state.track?.layers.find((l) => l.def.variable === variable)?.result.series ?? null;
}

function renderChart() {
  const s = seriesFor(state.chartVar) ?? state.track!.layers[0].result.series;
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
  const pal = PALETTES[state.palette];
  const rows = rolesHere().map(({ role, series }) => {
    const doc = ROLE_DOCS[role];
    const instrument = pal.instruments.find((i) => i.role.startsWith(role === "pitch" ? "pitch" : role === "density" ? "rhythmic" : role))?.name ?? "";
    const extra = role === "pitch" ? ` Scale: ${SCALES[state.experience].name}; ${state.pitchScale === "absolute" ? "global fixed range" : "this place's own min–max"}.` : "";
    return `<tr><th scope="row">${esc(series.label)}<br/><span class="muted small">${esc(series.unit)}</span></th><td><strong>${esc(doc.youHear)}</strong><br/><span class="small">${esc(doc.rule + extra)}</span>${instrument ? `<br/><span class="muted small">Instrument: ${esc(instrument)}</span>` : ""}</td></tr>`;
  });
  if (state.palette === "sega") rows.push(`<tr><th scope="row">Arrangement</th><td><span class="small">${esc(pal.arrangement)} The frame drum does <strong>not</strong> carry data.</span></td></tr>`);
  rows.push(`<tr><th scope="row">No data</th><td><span class="small">A soft, dull tick with the melody silent. Nothing is invented for missing or cloudy dates.</span></td></tr>`);
  $("mapping-table").innerHTML = `<thead><tr><th scope="col">Data</th><th scope="col">What you hear</th></tr></thead><tbody>${rows.join("")}</tbody>`;
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
    ["arrangement", "Drum (arrangement)", state.palette === "sega"],
  ];
  fs.innerHTML = `<legend>Layers</legend>` + opts
    .filter(([, , show]) => show)
    .map(([k, label]) => `<label><input type="checkbox" data-layer="${k}" ${state.layers[k] ? "checked" : ""}/> ${label}</label>`)
    .join("");
  fs.querySelectorAll<HTMLInputElement>("input").forEach((i) =>
    i.addEventListener("change", () => {
      state.layers[i.dataset.layer as keyof LayerToggles] = i.checked;
      announce(`${i.parentElement!.textContent!.trim()} layer ${i.checked ? "on" : "off"}`);
    }),
  );
}

function updateNowPlaying(f: SoundFrame | undefined) {
  const box = $("now-playing");
  if (!f || !state.track) {
    box.innerHTML = `<div class="np-row"><span class="k">Press play</span></div>`;
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
  const t = state.track!;
  const out: string[] = [];
  const pitch = t.layers.find((l) => l.def.roles.includes("pitch"))?.result.series ?? t.layers[0].result.series;
  const pts = pitch.points as CleanPoint[];
  const d = (p: { time: string }) => esc(fmtDate(p.time, pitch, true));
  const f = (s: CleanSeries, v: number) => `<strong>${esc(fmtValue(v, s.unit))}</strong>`;
  out.push(`<p>You heard <strong>${pts.length} ${t.period.label.includes("daily") ? "days" : t.period.label.includes("monthly") ? "months" : "time steps"}</strong> at ${esc(state.region.name)}, from ${d(pts[0])} (left ear) to ${d(pts[pts.length - 1])} (right ear).</p>`);
  out.push("<ul>");
  for (const l of t.layers) {
    const s = l.result.series;
    const w = VARIABLE_WORDS[s.variable] ?? { short: s.label, more: "higher", less: "lower" };
    const st = s.stats;
    for (const role of l.def.roles) {
      const doc = ROLE_DOCS[role];
      out.push(`<li><strong>${esc(doc.youHear)}</strong> followed ${esc(w.short)}: ${role === "pitch" ? `highest note at ${f(s, st.max)} (${d(st.maxPoint)}), lowest at ${f(s, st.min)} (${d(st.minPoint)}); average ${f(s, st.mean)}.` : `values from ${f(s, st.min)} to ${f(s, st.max)} (average ${f(s, st.mean)}); ${esc(w.more)} → ${role === "density" ? "busier rhythm" : role === "brightness" ? "brighter sound" : role === "texture" ? "fuller pad" : "different harmony"}.`}</li>`);
    }
    if (st.gaps) out.push(`<li>${st.gaps} date${st.gaps > 1 ? "s" : ""} of ${esc(w.short)} had no usable data (missing, cloudy or snow) — you heard a soft tick.</li>`);
  }
  out.push("</ul>");
  const vals = pts.filter((p) => p.value !== null && !p.bridged).map((p) => p.value as number);
  if (vals.length >= 24) {
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const n = Math.min(12, Math.floor(vals.length / 4));
    const diff = mean(vals.slice(-n)) - mean(vals.slice(0, n));
    out.push(`<p>Comparing the first and last ${n} values: the end of the period averaged ${f(pitch, Math.abs(diff))} ${diff >= 0 ? "higher" : "lower"}. A short window like this mixes weather and seasons with any longer trend, so it is not, on its own, evidence of climate change.</p>`);
  }
  out.push(`<p><strong>Limits:</strong> ${t.layers.map((l) => esc(LIMITATIONS[l.def.variable] ?? "")).filter(Boolean).join(" ")}</p>`);
  const simLayers = t.layers.filter((l) => l.result.series.source.kind === "simulated");
  if (simLayers.length) out.push(`<p><em>${simLayers.map((l) => esc(l.result.series.label)).join(", ")} ${simLayers.length > 1 ? "are" : "is"} simulated demonstration data, not observations.</em></p>`);
  $("understand-text").innerHTML = out.join("");
}

// ---------------------------------------------------------------------------
// Source details dialog
// ---------------------------------------------------------------------------
function renderSourceDetails() {
  const t = state.track;
  if (!t) return;
  $("source-details").innerHTML = t.layers
    .map(({ def, result }) => {
      const s = result.series;
      const src = s.source;
      const pts = s.points;
      const from = { bundled: "Bundled file shipped with the app (pre-fetched with npm run fetch-data)", live: "Live request from your browser this session", simulated: "Generated in your browser" }[result.origin];
      const url = src.url ? src.url.split(/\s{2,}/) : [];
      const rows: [string, string][] = [
        ["Type", src.kind === "nasa" ? `<span class="kind-tag nasa">◆ NASA observation / analysis</span>` : `<span class="kind-tag sim">◇ ${esc(SIMULATED_LABEL)}</span>`],
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
// Player
// ---------------------------------------------------------------------------
function updateProgress(i: number) {
  const pr = $<HTMLInputElement>("progress");
  const n = state.frames.length;
  const idx = Math.min(i, Math.max(0, n - 1));
  pr.value = String(idx);
  const f = state.frames[idx];
  const label = f && state.track ? fmtDate(f.time, state.track.layers[0].result.series, true) : "—";
  pr.setAttribute("aria-valuetext", `${label}, step ${idx + 1} of ${n}`);
  $("player-date").textContent = label;
  $("player-time").textContent = `${fmtClock(Math.min(i, n) * player.stepSec)} / ${fmtClock(player.durationSec)}`;
}

player.onStep((i, f) => {
  engine.play(f, player.stepSec, { experience: state.experience, palette: state.palette, layers: state.layers });
  chart.setPlayheadTime(f.time);
  updateProgress(i);
  updateNowPlaying(f);
});

player.onState((s) => {
  const playing = s === "playing";
  document.body.classList.toggle("playing", playing);
  $("play-icon").setAttribute("href", playing ? "#i-pause" : "#i-play");
  $("btn-play").setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
  $("audio-status").textContent = s.toUpperCase();
  if (s === "stopped") {
    updateProgress(player.index >= state.frames.length ? state.frames.length : 0);
    if (player.index >= state.frames.length) {
      announce("Finished. See “What you heard” in the Listen panel for an explanation.");
      speak($("understand-text").innerText);
    } else chart.hidePlayhead();
  }
  if (playing) startVisualizer();
});

async function play() {
  lab.stop();
  await engine.start();
  player.play();
}
async function togglePlay() {
  if (player.playing) player.pause();
  else await play();
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
    if (!engine.running) return;
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
    const blob = await renderFramesToWav(state.frames, player.stepSec, { experience: state.experience, palette: state.palette, layers: state.layers });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `earthsona-${state.experience}-${state.region.id}-${state.track?.period.key}-${state.palette}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    announce("WAV file ready.");
  } finally {
    btn.disabled = false;
  }
}

function speak(text: string) {
  if (!settings.voice || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// ---------------------------------------------------------------------------
// Globe layers
// ---------------------------------------------------------------------------
function applyOverlay() {
  const sel = $<HTMLSelectElement>("overlay-select");
  const ov = IMAGERY.overlays[state.experience];
  sel.options[1].textContent = `NASA data layer: ${ov.title}`;
  sel.value = settings.overlay;
  globe.setOverlay(settings.overlay === "exp" ? ov.file : null, (ok) => {
    $("stage-caption").textContent =
      (globe.realImagery
        ? `Imagery: NASA GIBS — ${settings.night ? IMAGERY.night.title : IMAGERY.base.title}`
        : "Globe: stylised placeholder map (NASA imagery not bundled yet — run npm run fetch-data -- --only=imagery)") +
      (settings.overlay === "exp" ? (ok ? `; overlay: ${ov.title} (${ov.layer}).` : "; data overlay unavailable offline.") : ".") +
      " Drag to rotate, scroll to zoom, click to pick a place.";
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
  local.forEach((r, i) => items.push(`<li><button data-local="${i}">${esc(r.name)}<span class="sub">Listed place</span></button></li>`));
  remote.forEach((r, i) => items.push(`<li><button data-remote="${i}">${esc(r.display_name.split(",")[0])}<span class="sub">${esc(r.display_name)}</span></button></li>`));
  box.innerHTML = `<h2 class="eyebrow">Search results</h2>` + (items.length ? `<ul>${items.join("")}</ul>` : `<p class="muted small">${navigator.onLine ? "No places found." : "Search needs internet. Pick a listed place or click the globe."}</p>`) + `<button class="btn small ghost" id="search-close">Close results</button>`;
  box.querySelectorAll<HTMLButtonElement>("button[data-local]").forEach((b) => (b.onclick = () => ((box.hidden = true), selectRegion(local[+b.dataset.local!]))));
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
  $("about-body").innerHTML = `
  <p><strong>EARTHSONA — Hear the Earth. Understand the Change.</strong> Built for NASA Space Apps 2026, <em>The Earth Information Jukebox</em>.
  Real NASA measurements are turned into sound: <code>NASA dataset → processing → normalisation → documented mapping → music → audio</code>.</p>
  <h3>Data sources</h3>
  <div class="table-scroll flat"><table class="sources">
    <thead><tr><th scope="col">Experience</th><th scope="col">Dataset</th><th scope="col">Status</th></tr></thead>
    <tbody>
      <tr><td>🌊 Ocean Symphony</td><td>NASA/JPL MUR SST v4.1 (GHRSST L4, ~1 km, daily) and its anomaly, sampled weekly, via NOAA ERDDAP (<code>jplMURSST41</code>, <code>jplMURSST41anom1day</code>)</td><td>◆ NASA data when fetched; otherwise ◇ simulated</td></tr>
      <tr><td>🌳 Forest Voices</td><td>MODIS MOD13Q1.061 Terra NDVI + EVI, 250 m, 16-day, with pixel-reliability QA, via ORNL DAAC</td><td>◆ NASA data</td></tr>
      <tr><td>💓 Earth's Pulse</td><td>NASA POWER (LaRC): T2M, PRECTOTCORR, ALLSKY_SFC_SW_DWN — monthly 2015–2024 and daily 2024</td><td>◆ NASA data</td></tr>
      <tr><td>Globe</td><td>NASA GIBS: Blue Marble shaded relief &amp; bathymetry; VIIRS Black Marble 2016; data overlays (MUR SST, MODIS NDVI, MERRA-2 T2M)</td><td>NASA imagery (visual only)</td></tr>
      <tr><td>Beside each experience</td><td>NASA Scientific Visualization Studio / Earth Information Center (Earth Now dashboard)</td><td>Visual only, not sonified</td></tr>
      <tr><td>Place search</td><td>OpenStreetMap Nominatim (© OpenStreetMap contributors)</td><td>Not NASA; online only</td></tr>
    </tbody></table></div>
  <h3>Citations</h3>
  <p class="cite"><strong>NASA POWER.</strong> ${esc(POWER_REFERENCE)} API version and access date are given per dataset in “details”.</p>
  <p class="cite"><strong>MODIS.</strong> ${esc(MOD13Q1_REFERENCE)} ${esc(TESVIS_REFERENCE)}</p>
  <p class="cite"><strong>MUR SST.</strong> ${esc(MUR_REFERENCE)}</p>
  <p class="cite"><strong>Imagery.</strong> We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS). ${esc(SVS_REFERENCE)}</p>
  <h3>How the sound is made</h3>
  <ul>
    ${(["pitch", "harmony", "density", "brightness", "texture"] as SoundRole[]).map((r) => `<li><strong>${esc(ROLE_DOCS[r].youHear)}</strong>: ${esc(ROLE_DOCS[r].rule)}</li>`).join("")}
    <li><strong>No data</strong> (fill values, MODIS cloudy/snow composites): a soft dull tick; nothing is invented. A single missing point between two real values is interpolated and labelled “interpolated”.</li>
    <li><strong>Sound profiles</strong> change instruments and arrangement only. The same value gives the same note, rhythm density, brightness and harmony in every profile.</li>
  </ul>
  <h3>Regional sound: ${esc(sega.name)}</h3>
  <p>${esc(sega.description)} ${esc(sega.arrangement)}</p>
  <p>${esc(sega.disclaimer ?? "")}</p>
  <ul>${sega.references.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join("")}</ul>
  <h3>Earth Sound Lab</h3>
  <p>Mode 1 plays a real observation. Mode 2 lets you change values; those are clearly labelled simulated, change only the sound, and are not forecasts. The lab does not model links between variables.</p>
  <h3>Known limitations</h3>
  <ul>
    <li>Each value is for one point/cell (POWER ≈ 0.5° × 0.625°; MODIS one 250 m pixel; MUR ≈ 1 km), not an average over a whole region.</li>
    <li>“Relative” pitch is scaled per series; use “Global” pitch to compare places.</li>
    <li>Ocean data needs an ERDDAP server that is reachable when running <code>npm run fetch-data</code>; until then Ocean Symphony plays simulated data and says so.</li>
  </ul>`;
}

// ---------------------------------------------------------------------------
// Lab & guide
// ---------------------------------------------------------------------------
const lab = new SoundLab(
  engine,
  () => ({ experience: state.experience, track: state.track, palette: state.palette, layers: state.layers }),
  async () => {
    player.pause();
    await engine.start();
  },
);

new Guide(
  [
    { title: "Discover", body: "Choose an experience on the left — 🌊 ocean temperature, 🌳 vegetation or 💓 climate — then a place from the list or anywhere on the globe.", action: "Show Mauritius", run: () => selectRegion(getRegion(getExperience(state.experience).regions[0])!) },
    { title: "Learn", body: "The Location panel tells you where you are, a short sourced fact, and which NASA data exists for this place.", action: "Open Location", run: () => showTab("tab-location") },
    { title: "Listen", body: "Press Play (or Space). Each note is one date, from left ear (earliest) to right ear (latest). Higher notes mean higher values.", action: "Play now", run: () => { showTab("tab-listen"); play(); } },
    { title: "Explore", body: "Change the time period or place, switch the sound profile, mute layers in the player, or try your own values in the Sound Lab.", action: "Open Sound Lab", run: () => showTab("tab-lab") },
    { title: "Understand", body: "“What you heard” explains which variable made which sound, the real values behind it, and the limits of what it means.", action: "Read it", run: () => { showTab("tab-listen"); $("understand-h").scrollIntoView({ block: "start" }); } },
  ],
  () => showTab("tab-listen"),
);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const openDialog = (id: string) => ($(id) as HTMLDialogElement).showModal();
document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) => (b.onclick = () => (b.closest("dialog") as HTMLDialogElement).close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => e.target === d && d.close()));

$("source-badge").onclick = () => (renderSourceDetails(), openDialog("dlg-source"));
$("btn-settings").onclick = () => openDialog("dlg-settings");
$("btn-about").onclick = () => openDialog("dlg-about");
$("btn-keys").onclick = () => openDialog("dlg-keys");
$("btn-start-guide").onclick = () => showTab("tab-guide");
$("btn-listen-here").onclick = () => (showTab("tab-listen"), play());
$("btn-play").onclick = togglePlay;
$("btn-stop").onclick = () => player.stop();
$("btn-replay").onclick = async () => (lab.stop(), await engine.start(), player.replay());
$("btn-wav").onclick = exportWav;
$("btn-reset").onclick = () => globe.reset();
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
    updateNowPlaying(f);
    updateProgress(i);
  }
};
$<HTMLSelectElement>("mode").onchange = (e) => ((state.mode = (e.target as HTMLSelectElement).value as "auto" | "simulated"), loadTrack());
$<HTMLSelectElement>("period").onchange = (e) => ((state.periodIndex = +(e.target as HTMLSelectElement).value), loadTrack());
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
  if (!player.playing) play();
};

$<HTMLSelectElement>("overlay-select").onchange = (e) => {
  settings.overlay = (e.target as HTMLSelectElement).value;
  savePref("settings", settings);
  applyOverlay();
};
const bind = (id: string, key: "live" | "loop" | "voice" | "night", apply: (v: boolean) => void) => {
  const el = $<HTMLInputElement>(id);
  el.checked = settings[key];
  apply(settings[key]);
  el.onchange = () => {
    settings[key] = el.checked;
    savePref("settings", settings);
    apply(el.checked);
  };
};
let booted = false;
bind("set-live", "live", () => booted && loadTrack());
bind("set-loop", "loop", (v) => (player.loop = v));
bind("set-voice", "voice", (v) => !v && "speechSynthesis" in window && speechSynthesis.cancel());
bind("set-night", "night", (v) => {
  globe.setStyle(v ? "night" : "day");
  applyOverlay();
});

const setText = (s: number) => {
  settings.textScale = Math.min(1.5, Math.max(0.85, Math.round(s * 100) / 100));
  document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  savePref("settings", settings);
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
  if (t.closest("input, select, textarea, dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
  const onButton = ["BUTTON", "SUMMARY", "A"].includes(t.tagName) || t.getAttribute("role") === "tab";
  switch (e.key) {
    case " ":
      if (onButton) return;
      e.preventDefault();
      togglePlay();
      break;
    case "s": case "S": player.stop(); break;
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
applyOverlay();
globe.flyTo(state.region.lat, state.region.lon);
globe.setLabel(state.region.name.split(",")[0], state.region.lat, state.region.lon);
loadTrack();
booted = true;

// Debug hook for automated checks (no effect on the UI).
(window as unknown as { __earthsona: unknown }).__earthsona = { state, player, registry, engine };
