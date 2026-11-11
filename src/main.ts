import "./styles.css";
import { Globe } from "./globe";
import { SonificationEngine, renderSeriesToWav } from "./audio/engine";
import { SeriesPlayer } from "./audio/player";
import { SeriesChart, renderTable } from "./ui/chart";
import { esc, fmtDate, fmtValue } from "./ui/format";
import { DataRegistry, type SeriesResult } from "./data/registry";
import { EXPERIENCES, REGIONS, customRegion, getExperience, getRegion } from "./data/regions";
import { loadEicFrame } from "./data/eic";
import { MOD13Q1_REFERENCE, POWER_REFERENCE, SIMULATED_LABEL, SVS_REFERENCE, TESVIS_REFERENCE } from "./data/parsers.js";
import type { CleanPoint } from "./data/normalise";
import type { CleanSeries, ExperienceId, RegionDef } from "./data/types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const COLORS: Record<ExperienceId, string> = { ocean: "#38bdf8", forest: "#4ade80", pulse: "#fbbf24" };

const settings = loadSettings();
const state = {
  experience: "pulse" as ExperienceId,
  region: getRegion("port-louis") as RegionDef,
  variableIndex: 0,
  mode: "auto" as "auto" | "simulated",
  result: null as SeriesResult | null,
  token: 0,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const registry = new DataRegistry();
const engine = new SonificationEngine();
const player = new SeriesPlayer();
const chart = new SeriesChart($("chart"));
const globe = new Globe($("globe"));

// ---------------------------------------------------------------------------
// Settings (per-viewer convenience only; app works if storage is blocked)
// ---------------------------------------------------------------------------
interface Settings { live: boolean; clouds: boolean; night: boolean; loop: boolean; voice: boolean }
function loadSettings(): Settings {
  const d: Settings = { live: false, clouds: true, night: false, loop: true, voice: false };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem("earthsona.settings") ?? "{}") };
  } catch {
    return d;
  }
}
function saveSettings() {
  try {
    localStorage.setItem("earthsona.settings", JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Notices & screen-reader announcements
// ---------------------------------------------------------------------------
let noticeTimer: number | undefined;
function notice(msg: string) {
  const el = $("notice");
  el.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-wifi-off"/></svg><span>${esc(msg)}</span>`;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (el.textContent = ""), 9000);
}
function announce(msg: string) {
  const el = $("sr-status");
  el.textContent = "";
  requestAnimationFrame(() => (el.textContent = msg));
}

// ---------------------------------------------------------------------------
// Experience tabs, region chips, variable switch
// ---------------------------------------------------------------------------
function renderTabs() {
  const nav = $("tabs");
  nav.innerHTML = "";
  EXPERIENCES.forEach((e, i) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(e.id === state.experience));
    b.setAttribute("aria-controls", "panel");
    b.tabIndex = e.id === state.experience ? 0 : -1;
    b.style.setProperty("--tab", COLORS[e.id]);
    b.innerHTML = `<span class="swatch" aria-hidden="true"></span>${e.title}<span class="sr-only"> (key ${i + 1})</span>`;
    b.onclick = () => selectExperience(e.id);
    b.onkeydown = (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      ev.stopPropagation();
      const next = EXPERIENCES[(i + (ev.key === "ArrowRight" ? 1 : EXPERIENCES.length - 1)) % EXPERIENCES.length];
      selectExperience(next.id);
      (nav.children[EXPERIENCES.indexOf(next)] as HTMLElement).focus();
    };
    nav.appendChild(b);
  });
}

async function renderChips() {
  const exp = getExperience(state.experience);
  const manifest = await registry.loadManifest();
  const box = $("region-chips");
  box.innerHTML = "";
  for (const id of exp.regions) {
    const r = getRegion(id)!;
    const real = manifest?.series.some((s) => s.experience === exp.id && s.regionId === id);
    const b = document.createElement("button");
    b.className = "chip";
    b.setAttribute("aria-pressed", String(state.region.id === id));
    b.innerHTML = `${esc(r.name)}<span class="tag ${real ? "real" : ""}">${real ? "◆ NASA data bundled" : "◇ simulated"}</span>`;
    b.onclick = () => selectRegion(r);
    box.appendChild(b);
  }
  globe.setMarkers(exp.regions.map((id) => ({ id, lat: getRegion(id)!.lat, lon: getRegion(id)!.lon })), COLORS[exp.id]);
}

function renderVariableSwitch() {
  const exp = getExperience(state.experience);
  const box = $("variable-switch");
  box.innerHTML = "";
  if (exp.series.length < 2) return;
  exp.series.forEach((def, i) => {
    const b = document.createElement("button");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(i === state.variableIndex));
    b.textContent = def.variable === "T2M" ? "Air temperature" : def.variable === "PRECTOTCORR" ? "Rainfall" : def.variable;
    b.onclick = () => {
      state.variableIndex = i;
      renderVariableSwitch();
      loadSeries();
    };
    box.appendChild(b);
  });
}

function selectExperience(id: ExperienceId) {
  if (id === state.experience) return;
  state.experience = id;
  state.variableIndex = 0;
  const exp = getExperience(id);
  // Keep a custom point; otherwise jump to the experience's first region (keep it if shared).
  if (!("custom" in state.region) && !exp.regions.includes(state.region.id)) state.region = getRegion(exp.regions[0])!;
  document.body.dataset.exp = id;
  engine.setExperience(id);
  renderTabs();
  renderChips();
  renderVariableSwitch();
  renderEic();
  loadSeries();
}

function selectRegion(r: RegionDef) {
  state.region = r;
  globe.flyTo(r.lat, r.lon);
  renderChips();
  loadSeries();
}

function cycleRegion(dir: 1 | -1) {
  const ids = getExperience(state.experience).regions;
  const i = ids.indexOf(state.region.id);
  selectRegion(getRegion(ids[(i + dir + ids.length) % ids.length])!);
}

// ---------------------------------------------------------------------------
// Load a series through the registry, then update EVERYTHING from it
// ---------------------------------------------------------------------------
async function loadSeries() {
  const token = ++state.token;
  const exp = getExperience(state.experience);
  const def = exp.series[state.variableIndex] ?? exp.series[0];
  $("exp-title").textContent = exp.title;
  $("exp-tagline").textContent = exp.tagline;
  $("region-name").textContent = state.region.name;
  $("region-coords").textContent = `${state.region.lat.toFixed(2)}°, ${state.region.lon.toFixed(2)}°`;
  $("understand-text").textContent = "Loading data…";

  const result = await registry.getSeries({ experience: exp.id, region: state.region, def, mode: state.mode, live: settings.live });
  if (token !== state.token) return; // a newer request superseded this one
  state.result = result;
  const s = result.series;

  if (result.notice) notice(result.notice);
  else if (state.mode === "auto" && result.origin === "simulated" && "custom" in state.region && !settings.live && def.source !== "sst") {
    notice("No bundled NASA data for this point. Turn on “Use live NASA data” in Settings to fetch it, or pick a listed place.");
  }

  renderBadge(result);
  $("chart-title").textContent = `${s.label} (${s.unit})`;
  chart.render(s, COLORS[exp.id]);
  $("data-table").innerHTML = renderTable(s);
  $("understand-text").innerHTML = understandText(s, result);
  earthySays(s, result);

  player.load(s);
  if (player.playing) chart.setPlayhead(player.index);
  else {
    chart.hidePlayhead();
    $("np-date").textContent = "—";
    $("np-value").textContent = "Press play";
  }
  announce(`${exp.title}: ${s.label} at ${s.region.name}. ${badgeText(result).text}. ${player.playing ? "" : "Press space to play."}`);
}

function badgeText(r: SeriesResult) {
  if (r.series.source.kind === "nasa") {
    const short = r.series.source.name.startsWith("NASA POWER") ? "NASA POWER" : r.series.source.name.includes("MODIS") ? "NASA MODIS (ORNL DAAC)" : r.series.source.name;
    return { text: `NASA data: ${short}`, why: r.origin === "live" ? "live request" : "bundled observations" };
  }
  return { text: "Simulated demonstration data", why: "not a NASA observation" };
}

function renderBadge(r: SeriesResult) {
  const b = $("source-badge");
  const nasa = r.series.source.kind === "nasa";
  const t = badgeText(r);
  b.className = `badge ${nasa ? "nasa" : "sim"}`;
  b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${nasa ? "i-satellite" : "i-flask"}"/></svg><span>${esc(t.text)}<span class="why">${esc(t.why)} · details</span></span>`;
  b.setAttribute("aria-label", `${t.text}, ${t.why}. Show source details.`);
}

function renderSourceDetails() {
  const r = state.result;
  if (!r) return;
  const s = r.series;
  const src = s.source;
  const pts = s.points;
  const from = { bundled: "Bundled file shipped with the app (pre-fetched with npm run fetch-data)", live: "Live request from your browser this session", simulated: "Generated in your browser" }[r.origin];
  const rows: [string, string][] = [
    ["Type", src.kind === "nasa" ? `<span class="kind-tag nasa">NASA observation / model data</span>` : `<span class="kind-tag sim">${esc(SIMULATED_LABEL)}</span>`],
    ["Source", esc(src.name)],
    ...(src.product ? ([["Product", esc(src.product)]] as [string, string][]) : []),
    ["Variable", `${esc(s.label)} — <code>${esc(s.variable)}</code>, ${esc(s.unit)}`],
    ["Place", `${esc(s.region.name)} (${s.region.lat}, ${s.region.lon})`],
    ["Period", `${fmtDate(pts[0].time, s, true)} – ${fmtDate(pts[pts.length - 1].time, s, true)} · ${pts.length} points, ${s.stats.gaps} without data`],
    ["Loaded from", from],
    ...(src.url ? ([["Request URL", urlCell(src.url)]] as [string, string][]) : []),
    ...(src.retrievedAt ? ([["Retrieved", new Date(src.retrievedAt).toUTCString()]] as [string, string][]) : []),
    ["Citation", esc(src.citation)],
  ];
  $("source-details").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

function urlCell(u: string) {
  const [url, rest] = u.split(/\s{2,}/);
  return `<a href="${esc(url)}" target="_blank" rel="noopener"><code>${esc(url)}</code></a>${rest ? ` <span class="muted">${esc(rest)}</span>` : ""}`;
}

/** "Understand" text — always computed from the series actually loaded. */
function understandText(s: CleanSeries, r: SeriesResult): string {
  const st = s.stats;
  const pts = s.points as CleanPoint[];
  const f = (v: number) => `<strong>${esc(fmtValue(v, s.unit))}</strong>`;
  const d = (p: { time: string }) => esc(fmtDate(p.time, s, true));
  let txt =
    `From ${d(pts[0])} to ${d(pts[pts.length - 1])}, ${esc(s.label.toLowerCase())} at ${esc(s.region.name)} ranged from ` +
    `${f(st.min)} (${d(st.minPoint)}) to ${f(st.max)} (${d(st.maxPoint)}), averaging ${f(st.mean)} over ${st.count} values.`;
  const trend = yearTrend(pts);
  if (trend !== null && Math.abs(trend) > 0) {
    txt += ` The last 12 values averaged ${f(Math.abs(trend))} ${trend > 0 ? "higher" : "lower"} than the first 12.`;
  }
  if (st.gaps) txt += ` ${st.gaps} date${st.gaps > 1 ? "s have" : " has"} no data — you'll hear a soft tick there.`;
  const bridged = pts.filter((p) => p.bridged).length;
  if (bridged) txt += ` ${bridged} single missing value${bridged > 1 ? "s were" : " was"} bridged by interpolation.`;
  if (s.unit.startsWith("NDVI")) txt += " NDVI near 0 means bare ground, water or buildings; above about 0.6 means dense, healthy vegetation.";
  if (r.series.source.kind === "simulated") txt += ` <em>These are simulated numbers for demonstration, not observations.</em>`;
  return txt;
}

function yearTrend(pts: CleanPoint[]): number | null {
  const vals = pts.filter((p) => p.value !== null && !p.bridged).map((p) => p.value as number);
  if (vals.length < 24) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return Math.round((mean(vals.slice(-12)) - mean(vals.slice(0, 12))) * 100) / 100;
}

/** Earthy's dialogue + mood (character idea from the "Meet Earthy" companion prototype). */
function earthySays(s: CleanSeries, r: SeriesResult) {
  const trend = yearTrend(s.points as CleanPoint[]);
  const span = s.stats.max - s.stats.min || 1;
  const rel = trend === null ? 0 : trend / span;
  let mood = "Curious";
  let face = "🌍";
  let line = "";
  const where = s.region.name.split(",")[0];
  if (s.variable === "T2M" || s.variable === "SST") {
    line = `Listen to ${where}'s seasons rise and fall: high notes are the warmest ${s.variable === "SST" ? "sea" : "air"}, low notes the coolest.`;
    if (rel > 0.1) [mood, face, line] = ["Feeling warm", "🥵", `${line} The latest year sounds a little higher than the first.`];
  } else if (s.variable === "NDVI") {
    line = `Each note is one 16-day satellite look at ${where}'s plants. Bright, high notes mean lush green leaves.`;
    if (s.stats.mean > 0.6) [mood, face] = ["Feeling green", "🌳"];
    if (rel < -0.1) [mood, face, line] = ["A bit concerned", "😟", `${line} The last year sounds a little lower: less greenness than at the start.`];
  } else if (s.variable === "PRECTOTCORR") {
    line = `Rain in ${where}! Every high note is a wet month; the big jumps make the sound wobble.`;
    [mood, face] = ["Splashy", "🌧️"];
  }
  if (r.series.source.kind === "simulated") line += " (Psst — this one is simulated practice data, not a real measurement.)";
  $("earthy-mood").textContent = mood;
  $("earthy-avatar").textContent = face;
  $("earthy-text").textContent = line;
  if (settings.voice && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.pitch = 1.1;
    speechSynthesis.speak(u);
  }
}

// ---------------------------------------------------------------------------
// EIC frame
// ---------------------------------------------------------------------------
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
  // Never leave the previous experience's frame on screen under the new caption.
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
  $("eic-meta").innerHTML = `NASA SVS #${frame.svsId}${date ? ` · released ${esc(date)}` : ""} · <a href="${esc(frame.pageUrl)}" target="_blank" rel="noopener">view on svs.gsfc.nasa.gov</a> · supporting visual, not the data being played`;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
player.onStep((i, p, frame) => {
  engine.play(frame, player.stepSec);
  chart.setPlayhead(i);
  const s = state.result!.series;
  $("np-date").textContent = fmtDate(p.time, s, true);
  $("np-value").textContent = p.value === null ? "No data" : `${fmtValue(p.value, s.unit)}${p.bridged ? " (interpolated)" : ""}`;
});
player.onEnd(() => setPlaying(false));

async function setPlaying(on: boolean) {
  if (on) {
    await engine.start();
    engine.setExperience(state.experience);
    player.play();
    startVisualizer();
  } else {
    player.pause();
    await engine.stop();
  }
  document.body.classList.toggle("playing", on);
  $("play-icon").setAttribute("href", on ? "#i-pause" : "#i-play");
  $("btn-play").setAttribute("aria-label", on ? "Pause sonification (Space)" : "Play sonification (Space)");
  $("audio-status").textContent = on ? "PLAYING" : "STANDBY";
  announce(on ? `Playing ${state.result?.series.label ?? ""}` : "Paused");
}
const togglePlay = () => setPlaying(!player.playing);

chart.onSeek = (i) => {
  player.seek(i);
  if (!player.playing) setPlaying(true);
};

function startVisualizer() {
  const canvas = $<HTMLCanvasElement>("visualizer");
  const ctx = canvas.getContext("2d")!;
  const an = engine.analyser!;
  const data = new Uint8Array(an.frequencyBinCount);
  const color = getComputedStyle(document.body).getPropertyValue("--exp").trim() || "#22d3ee";
  const draw = () => {
    if (!player.playing) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    requestAnimationFrame(draw);
    an.getByteFrequencyData(data);
    ctx.fillStyle = "rgba(3,7,18,0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bw = (canvas.width / data.length) * 2.2;
    ctx.fillStyle = color;
    data.forEach((v, i) => {
      const h = (v / 255) * canvas.height;
      ctx.fillRect(i * (bw + 1), canvas.height - h, bw, h);
    });
  };
  draw();
}

async function exportWav() {
  if (!state.result) return;
  const btn = $<HTMLButtonElement>("btn-wav");
  btn.disabled = true;
  announce("Rendering WAV file…");
  try {
    const blob = await renderSeriesToWav(player.frames, state.experience, player.stepSec);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.result.series.id}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    announce("WAV file ready.");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Search (OpenStreetMap Nominatim — online only, not NASA data)
// ---------------------------------------------------------------------------
async function search(q: string) {
  const box = $("search-results");
  if (q.trim().length < 2) return;
  box.hidden = false;
  box.innerHTML = `<p class="muted small" style="padding:8px">Searching…</p>`;
  const local = REGIONS.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  let remote: { display_name: string; lat: string; lon: string }[] = [];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) remote = await r.json();
  } catch {
    /* offline */
  }
  box.innerHTML = "";
  const add = (label: string, sub: string, go: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `${esc(label)}<span class="sub">${esc(sub)}</span>`;
    b.onclick = () => {
      box.hidden = true;
      go();
    };
    box.appendChild(b);
  };
  local.forEach((r) => add(r.name, "Listed place", () => selectRegion(r)));
  remote.forEach((r) => add(r.display_name.split(",")[0], r.display_name, () => pickPoint(+r.lat, +r.lon, r.display_name.split(",")[0])));
  if (!box.children.length) box.innerHTML = `<p class="muted small" style="padding:8px">${remote.length === 0 && !navigator.onLine ? "Search needs internet. Click the globe or pick a listed place instead." : "No places found."}</p>`;
}

function pickPoint(lat: number, lon: number, name?: string) {
  selectRegion(customRegion(lat, lon, name));
}

// ---------------------------------------------------------------------------
// About / methodology
// ---------------------------------------------------------------------------
function renderAbout() {
  $("about-body").innerHTML = `
  <p><strong>EARTHSONA</strong> (with Earthy, our guide) was built for NASA Space Apps 2026 — <em>The Earth Information Jukebox</em>.
  It pairs NASA Earth Information Center visuals with sound driven by Earth data.</p>
  <h3>Sources: what is real and what is simulated</h3>
  <div class="table-scroll" style="max-height:none"><table class="sources">
    <thead><tr><th scope="col">Used for</th><th scope="col">Source</th><th scope="col">Status</th></tr></thead>
    <tbody>
      <tr><td>Earth's Pulse (air temperature T2M, rainfall PRECTOTCORR, monthly)</td><td>NASA POWER point API (LaRC), MERRA-2 based</td><td><span class="kind-tag nasa">◆ NASA data</span></td></tr>
      <tr><td>Forest Voices (NDVI, 16-day, 250 m)</td><td>MOD13Q1 v6.1 (Terra MODIS) via the ORNL DAAC TESViS web service</td><td><span class="kind-tag nasa">◆ NASA data</span></td></tr>
      <tr><td>Ocean Symphony (sea surface temperature)</td><td>Planned: JPL MUR SST (GHRSST L4) via ERDDAP — awaiting mentor confirmation</td><td><span class="kind-tag sim">◇ Simulated</span></td></tr>
      <tr><td>Any place without bundled data, live mode off or a failed request</td><td>Generated in the browser: baseline + seasonal cycle + trend + noise</td><td><span class="kind-tag sim">◇ Simulated</span></td></tr>
      <tr><td>Supporting visuals next to each experience</td><td>NASA Scientific Visualization Studio / Earth Information Center (Earth Now dashboard)</td><td>Visual only, not sonified</td></tr>
      <tr><td>3D globe surface</td><td>Stylised drawing made in code</td><td>Illustration, not imagery</td></tr>
      <tr><td>Place search</td><td>OpenStreetMap Nominatim (© OpenStreetMap contributors)</td><td>Not NASA, online only</td></tr>
    </tbody></table></div>
  <h3>Citations</h3>
  <p class="cite"><strong>NASA POWER.</strong> ${esc(POWER_REFERENCE)} The service name, API version and access date are shown in each dataset's source details.</p>
  <p class="cite"><strong>MODIS NDVI product.</strong> ${esc(MOD13Q1_REFERENCE)}</p>
  <p class="cite"><strong>MODIS web service.</strong> ${esc(TESVIS_REFERENCE)}</p>
  <p class="cite"><strong>EIC visuals.</strong> ${esc(SVS_REFERENCE)} https://svs.gsfc.nasa.gov/gallery/earth-now-dashboard/</p>
  <h3>Method</h3>
  <ol>
    <li><strong>Fetch.</strong> <code>npm run fetch-data</code> downloads POWER and MODIS series for the listed places and bundles them with the app, so the demo works without internet. Live requests are optional and limited to 10 s.</li>
    <li><strong>Clean.</strong> Fill values (POWER −999, MODIS −3000, or MODIS values outside −2000…10000) become “no data”. MODIS values are scaled by 0.0001. Points are sorted by date. Missing values at the start or end are trimmed, and a single missing point between two real values is interpolated and labelled. Statistics use real values only.</li>
    <li><strong>Sonify.</strong> Each value is scaled to 0–1 within its own series, which sets the pitch on a pentatonic scale and the filter brightness. The change from the previous point sets the tremolo, and the date sets the stereo position. Missing data plays a neutral tick.</li>
  </ol>
  <h3>Known limitations</h3>
  <ul>
    <li>Pitch is relative to each series, so the same note means different values in different places.</li>
    <li>Each value is for one point: POWER cells are about 0.5° × 0.625°, and MODIS pixels are 250 m. Neither is an average over a whole region.</li>
    <li>Ocean Symphony is entirely simulated until the SST source is confirmed.</li>
  </ul>`;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function openDialog(id: string) {
  ($(id) as HTMLDialogElement).showModal();
}
document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) => (b.onclick = () => (b.closest("dialog") as HTMLDialogElement).close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => e.target === d && d.close()));

$("source-badge").onclick = () => {
  renderSourceDetails();
  openDialog("dlg-source");
};
$("btn-settings").onclick = () => openDialog("dlg-settings");
$("btn-about").onclick = () => openDialog("dlg-about");
$("btn-keys").onclick = () => openDialog("dlg-keys");
$("btn-guide").onclick = () => openDialog("dlg-guide");
$("btn-play").onclick = togglePlay;
$("btn-wav").onclick = exportWav;
$("btn-reset").onclick = () => globe.reset();
$<HTMLSelectElement>("rate").onchange = (e) => player.setRate(+(e.target as HTMLSelectElement).value);
$<HTMLInputElement>("volume").oninput = (e) => engine.setVolume(+(e.target as HTMLInputElement).value);
$<HTMLSelectElement>("mode").onchange = (e) => {
  state.mode = (e.target as HTMLSelectElement).value as "auto" | "simulated";
  loadSeries();
};

const bindSetting = (id: string, key: keyof Settings, apply: (v: boolean) => void) => {
  const el = $<HTMLInputElement>(id);
  el.checked = settings[key];
  apply(settings[key]);
  el.onchange = () => {
    settings[key] = el.checked;
    saveSettings();
    apply(el.checked);
  };
};
bindSetting("set-live", "live", (v) => {
  if (state.result) loadSeries();
  void v;
});
bindSetting("set-clouds", "clouds", (v) => globe.setClouds(v));
bindSetting("set-night", "night", (v) => globe.setStyle(v ? "night" : "day"));
bindSetting("set-loop", "loop", (v) => (player.loop = v));

const speakBtn = $("btn-speak");
const renderSpeak = () => {
  speakBtn.setAttribute("aria-pressed", String(settings.voice));
  speakBtn.querySelector("span")!.textContent = settings.voice ? "Voice on" : "Voice off";
};
renderSpeak();
speakBtn.onclick = () => {
  settings.voice = !settings.voice;
  saveSettings();
  renderSpeak();
  if (!settings.voice) speechSynthesis?.cancel();
};

let searchTimer: number | undefined;
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  search($<HTMLInputElement>("search-input").value);
});
$("search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = (e.target as HTMLInputElement).value;
  if (!v) $("search-results").hidden = true;
  else searchTimer = window.setTimeout(() => search(v), 500);
});

globe.onPick = (lat, lon) => pickPoint(lat, lon);
globe.onMarker = (id) => selectRegion(getRegion(id)!);

addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("input, select, textarea, dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
  const onButton = t.tagName === "BUTTON" || t.tagName === "SUMMARY";
  switch (e.key) {
    case " ":
      if (onButton) return; // let Space activate the focused button
      e.preventDefault();
      togglePlay();
      break;
    case "1": case "2": case "3":
      selectExperience(EXPERIENCES[+e.key - 1].id);
      break;
    case "[": cycleRegion(-1); break;
    case "]": cycleRegion(1); break;
    case "r": case "R": globe.reset(); break;
    case "+": case "=": globe.zoom(0.9); break;
    case "-": case "_": globe.zoom(1.1); break;
    case "ArrowLeft": globe.rotate(-0.1, 0); break;
    case "ArrowRight": globe.rotate(0.1, 0); break;
    case "ArrowUp": globe.rotate(0, -0.1); break;
    case "ArrowDown": globe.rotate(0, 0.1); break;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.body.dataset.exp = state.experience;
renderTabs();
renderChips();
renderVariableSwitch();
renderAbout();
renderEic();
globe.flyTo(state.region.lat, state.region.lon);
loadSeries();

// Debug hook for automated checks (no effect on the UI).
(window as unknown as { __earthsona: unknown }).__earthsona = { state, player, registry };
