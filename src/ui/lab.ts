import type { SonificationEngine, LayerToggles } from "../audio/engine";
import type { Track } from "../data/registry";
import type { ExperienceId, RegionDef } from "../data/types";
import type { CleanPoint } from "../data/normalise";
import { EXPERIENCES, getExperience, getRegion } from "../data/regions";
import { labFrames, trackToFrames, type SoundFrame } from "../sonification/frames";
import { ABSOLUTE_RANGE, densityHits, harmonyIntervals, noteFrequency, noteIndex, noteName } from "../sonification/mappings";
import type { PaletteId } from "../sonification/palettes";
import { $, announce, esc } from "./dom";
import { fmtDate, fmtValue } from "./format";
import { KID, timeWindows, type TimeWindow } from "./kid";

/**
 * Earth Sound Lab — "✦ TRY THIS OUT ✦".
 *
 *  Compare real times (default): pick a world, a place and two REAL observation periods (years, or parts of a
 *  year for daily data). EARTHSONA plays both with the same rules and explains the difference in the numbers
 *  and in the sound. It describes what changed; it never says why.
 *
 *  What if?: a separate, clearly labelled make-believe mode with sliders. Values are not measurements, each
 *  slider only changes its own sound layer, and nothing is a forecast.
 */
type Var = "T2M" | "PRECTOTCORR" | "ALLSKY_SFC_SW_DWN" | "NDVI" | "EVI" | "SST" | "SSTA";
type Values = Partial<Record<Var, number>>;

const SLIDERS: Record<Var, { label: string; unit: string; step: number; help: string }> = {
  T2M: { label: "Air temperature", unit: "°C", step: 0.5, help: "Changes the melody note." },
  PRECTOTCORR: { label: "Rain", unit: "mm/day", step: 0.5, help: "Changes how many beats per note." },
  ALLSKY_SFC_SW_DWN: { label: "Sunshine", unit: "MJ/m²/day", step: 0.5, help: "Changes how bright the sound is." },
  NDVI: { label: "Greenness (NDVI)", unit: "", step: 0.01, help: "Changes the melody note and the background pad." },
  EVI: { label: "Leafiness (EVI)", unit: "", step: 0.01, help: "Changes the harmony: thin → open → full chord." },
  SST: { label: "Sea temperature", unit: "°C", step: 0.1, help: "Changes the melody note." },
  SSTA: { label: "Warmer or cooler than usual", unit: "°C", step: 0.1, help: "Changes the harmony: calm near 0, tense further away." },
};
const PITCH_VAR: Record<ExperienceId, Var> = { pulse: "T2M", forest: "NDVI", ocean: "SST" };

export interface LabHost {
  state: () => { experience: ExperienceId; region: RegionDef; track: Track | null; palette: PaletteId; layers: LayerToggles };
  selectExperience: (id: ExperienceId) => void;
  selectRegion: (id: string) => void;
  beforePlay: () => Promise<void>;
  afterPlay: () => void;
  /** Called once the child has heard both A and B (mission step "Compare"). */
  onCompared?: () => void;
}

export class EarthLab {
  mode: "compare" | "whatif" = "compare";
  private windows: TimeWindow[] = [];
  private a = "";
  private b = "";
  private timer: number | null = null;
  private wi: Values = {};
  private heard = new Set<string>();
  private real: Values = {};

  constructor(private engine: SonificationEngine, private host: LabHost) {
    $("lab-mode").querySelectorAll<HTMLButtonElement>("button").forEach((btn) =>
      btn.addEventListener("click", () => this.setMode(btn.dataset.mode as "compare" | "whatif")),
    );
    $<HTMLSelectElement>("lab-a").onchange = (e) => ((this.a = (e.target as HTMLSelectElement).value), this.explain());
    $<HTMLSelectElement>("lab-b").onchange = (e) => ((this.b = (e.target as HTMLSelectElement).value), this.explain());
    $("lab-play-a").onclick = () => this.playCompare(["A"]);
    $("lab-play-b").onclick = () => this.playCompare(["B"]);
    $("lab-play-ab").onclick = () => this.playCompare(["A", "B"]);
    $("lab-stop").onclick = () => this.stop();
    $("lab-wi-real").onclick = () => this.playValues([["Real", this.real]]);
    $("lab-wi-play").onclick = () => this.playValues([["What if", this.wi]]);
    $("lab-wi-ab").onclick = () => this.playValues([["Real", this.real], ["What if", this.wi]]);
  }

  /** Show the "Compare real times" mode (used by the mission step). */
  openCompare(): void {
    this.setMode("compare");
  }

  /** Call whenever the world / place / data changes (and when the dialog opens). */
  refresh(): void {
    const { experience, region, track } = this.host.state();
    this.heard.clear();
    // World and place pickers.
    $("lab-worlds").innerHTML = EXPERIENCES.map(
      (e) => `<button class="chip" role="radio" aria-checked="${e.id === experience}" data-exp="${e.id}">${e.icon} ${esc(e.short)}</button>`,
    ).join("");
    $("lab-worlds").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => this.host.selectExperience(b.dataset.exp as ExperienceId)));
    $("lab-places").innerHTML = getExperience(experience)
      .regions.map((id) => {
        const r = getRegion(id)!;
        return `<button class="chip" role="radio" aria-checked="${id === region.id}" data-region="${id}">${esc(r.short ?? r.name)}</button>`;
      })
      .join("");
    $("lab-places").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => this.host.selectRegion(b.dataset.region!)));

    // Real periods to compare.
    const axis = (track?.layers[0].result.series.points ?? []) as CleanPoint[];
    this.windows = timeWindows(axis.map((p) => p.time)).filter((w) => w.key !== "all");
    const keys = this.windows.map((w) => w.key);
    if (!keys.includes(this.a)) this.a = keys[0] ?? "";
    if (!keys.includes(this.b) || this.b === this.a) this.b = keys[keys.length - 1] ?? "";
    const opts = (sel: string) => this.windows.map((w) => `<option value="${esc(w.key)}" ${w.key === sel ? "selected" : ""}>${esc(w.label)}</option>`).join("");
    $<HTMLSelectElement>("lab-a").innerHTML = opts(this.a);
    $<HTMLSelectElement>("lab-b").innerHTML = opts(this.b);
    for (const id of ["lab-a", "lab-b", "lab-play-a", "lab-play-b", "lab-play-ab"]) ($(id) as HTMLButtonElement).disabled = !track;
    this.explain();

    // What-if starting point: the latest real measurement.
    this.real = {};
    if (track) {
      for (const l of track.layers) {
        const pts = (l.result.series.points as CleanPoint[]).filter((p) => p.value !== null && !p.bridged);
        const last = pts[pts.length - 1];
        if (last) this.real[l.def.variable as Var] = last.value as number;
      }
    }
    this.wi = { ...this.real };
    this.renderWhatIf();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.host.afterPlay();
    }
    $("lab-now").textContent = "";
  }

  private setMode(m: "compare" | "whatif") {
    this.stop();
    this.mode = m;
    $("lab-mode").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    $("lab-compare-mode").hidden = m !== "compare";
    $("lab-whatif-mode").hidden = m !== "whatif";
    announce(m === "compare" ? "Compare real times. Both sounds come from real measurements." : "What if mode. These values are make-believe, not measurements.");
  }

  // --- Compare two real periods --------------------------------------------
  private framesFor(key: string): SoundFrame[] {
    const { track } = this.host.state();
    const w = this.windows.find((x) => x.key === key);
    if (!track || !w) return [];
    // Global (absolute) pitch scale so the same value is the same note in A and B.
    const all = trackToFrames(track, "absolute").filter((f) => f.time >= w.from && f.time <= w.to);
    return all.map((f, i) => ({ ...f, index: i, pan: all.length > 1 ? (i / (all.length - 1)) * 2 - 1 : 0 }));
  }

  private stats(key: string) {
    const { track } = this.host.state();
    const w = this.windows.find((x) => x.key === key);
    const out: Record<string, { mean: number; n: number; gaps: number; unit: string; label: string; max: CleanPoint; min: CleanPoint }> = {};
    if (!track || !w) return out;
    for (const l of track.layers) {
      const s = l.result.series;
      const pts = (s.points as CleanPoint[]).filter((p) => p.time >= w.from && p.time <= w.to);
      const ok = pts.filter((p) => p.value !== null && !p.bridged);
      if (!ok.length) continue;
      out[s.variable] = {
        mean: ok.reduce((a, p) => a + (p.value as number), 0) / ok.length,
        n: ok.length,
        gaps: pts.length - ok.length,
        unit: s.unit,
        label: KID.label(s.variable),
        max: ok.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a)),
        min: ok.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a)),
      };
    }
    return out;
  }

  private explain() {
    const { track, experience, region } = this.host.state();
    const box = $("lab-explain");
    if (!track) {
      box.innerHTML = `<p>There are no real measurements for ${esc(region.name)} to compare. Pick another place.</p>`;
      $("lab-source").textContent = "";
      return;
    }
    if (this.windows.length < 2) {
      box.innerHTML = `<p>Only one time period is available here.</p>`;
      return;
    }
    const A = this.stats(this.a);
    const B = this.stats(this.b);
    const la = this.windows.find((w) => w.key === this.a)!.label;
    const lb = this.windows.find((w) => w.key === this.b)!.label;
    const pv = PITCH_VAR[experience];
    const rows: string[] = [];
    for (const v of Object.keys({ ...A, ...B })) {
      const x = A[v];
      const y = B[v];
      if (!x || !y) continue;
      const diff = y.mean - x.mean;
      const unit = x.unit.includes("unitless") ? "" : ` ${x.unit}`;
      const fmt = (n: number) => (x.unit.includes("unitless") ? n.toFixed(2) : n.toFixed(1));
      rows.push(`<tr><th scope="row">${esc(x.label)}</th><td>${esc(fmt(x.mean) + unit)}</td><td>${esc(fmt(y.mean) + unit)}</td><td>${diff >= 0 ? "+" : "−"}${esc(fmt(Math.abs(diff)) + unit)}</td></tr>`);
    }
    const p = A[pv] && B[pv] ? B[pv].mean - A[pv].mean : 0;
    const what = { ocean: "the sea was", forest: "the forest was", pulse: "the air was" }[experience];
    const word = { ocean: ["warmer", "cooler"], forest: ["greener", "less green"], pulse: ["warmer", "cooler"] }[experience];
    const small = Math.abs(p) < (experience === "forest" ? 0.01 : 0.1);
    const lines: string[] = [];
    if (A[pv] && B[pv]) {
      lines.push(
        small
          ? `On average ${what} about the same in ${esc(lb)} as in ${esc(la)}, so the melodies sit at about the same height.`
          : `On average ${what} <strong>${esc(word[p > 0 ? 0 : 1])} in ${esc(lb)}</strong> than in ${esc(la)}, so B's melody sits a little ${p > 0 ? "higher" : "lower"}.`,
      );
    }
    if (A.SSTA && B.SSTA) {
      const hot = (k: string) => this.framesFor(k).filter((f) => f.harmony?.kind === "anomaly" && f.harmony.anomaly >= 0.5).length;
      lines.push(`Weeks warmer than usual (tense harmony): <strong>${hot(this.a)}</strong> in ${esc(la)}, <strong>${hot(this.b)}</strong> in ${esc(lb)}.`);
    }
    if (A.PRECTOTCORR && B.PRECTOTCORR) {
      const d = B.PRECTOTCORR.mean - A.PRECTOTCORR.mean;
      if (Math.abs(d) >= 0.2) lines.push(`${esc(lb)} was ${d > 0 ? "rainier" : "drier"} on average, so you hear ${d > 0 ? "busier" : "calmer"} rain beats.`);
    }
    if ((A[pv]?.gaps ?? 0) + (B[pv]?.gaps ?? 0) > 0) lines.push(`Soft ticks are times without a usable measurement (${A[pv]?.gaps ?? 0} in A, ${B[pv]?.gaps ?? 0} in B).`);
    lines.push(`<em>One period compared with another mixes weather, seasons and longer changes. This shows what was measured, not why it changed.</em>`);
    box.innerHTML =
      `<div class="table-scroll flat"><table class="mapping"><thead><tr><th scope="col">Average</th><th scope="col">A · ${esc(la)}</th><th scope="col">B · ${esc(lb)}</th><th scope="col">Change</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>` +
      lines.map((x) => `<p>${x}</p>`).join("");
    const names = [...new Set(track.layers.map((l) => l.result.series.source.name))].join(" + ");
    $("lab-source").textContent = `Both A and B are real measurements from ${names}, played with the same rules and the global pitch scale.`;
  }

  private async playCompare(which: ("A" | "B")[]) {
    this.stop();
    const clips = which.map((k) => ({ k, key: k === "A" ? this.a : this.b, frames: this.framesFor(k === "A" ? this.a : this.b) })).filter((c) => c.frames.length);
    if (!clips.length) return;
    clips.forEach((c) => this.heard.add(c.k));
    if (this.heard.has("A") && this.heard.has("B")) this.host.onCompared?.();
    await this.host.beforePlay();
    const { experience, palette, layers } = this.host.state();
    const step = Math.max(0.1, Math.min(0.4, 7 / Math.max(...clips.map((c) => c.frames.length))));
    const label = (key: string) => this.windows.find((w) => w.key === key)?.label ?? key;
    const seq: { f: SoundFrame; clip: (typeof clips)[number]; first: boolean }[] = [];
    for (const c of clips) {
      c.frames.forEach((f, i) => seq.push({ f, clip: c, first: i === 0 }));
      // a short pause between A and B
      if (clips.length > 1 && c !== clips[clips.length - 1]) for (let i = 0; i < 4; i++) seq.push({ f: { ...c.frames[0], pitch: null, harmony: null, density: null, brightness: null, texture: null }, clip: c, first: false });
    }
    const { track } = this.host.state();
    const pitch = track?.layers.find((l) => l.def.roles.includes("pitch"))?.result.series;
    let i = 0;
    const tick = () => {
      const s = seq[i];
      if (s.first) announce(`Playing ${s.clip.k}: ${label(s.clip.key)}`);
      if (s.f.pitch !== null || s.first) {
        this.engine.play(s.f, step, { experience, palette, layers });
        const v = pitch ? s.f.values[pitch.variable] : undefined;
        $("lab-now").innerHTML = `<span class="ab-tag ${s.clip.k.toLowerCase()}">${s.clip.k}</span> ${esc(label(s.clip.key))} · ${esc(pitch ? fmtDate(s.f.time, pitch, true) : "")} · ${v?.value === null || !v ? "no data" : esc(fmtValue(v.value, pitch!.unit))}`;
      }
      i++;
      if (i < seq.length) this.timer = window.setTimeout(tick, step * 1000);
      else {
        this.timer = window.setTimeout(() => this.stop(), 1500);
      }
    };
    tick();
  }

  // --- What if? (make-believe) ---------------------------------------------
  private renderWhatIf() {
    const { track, experience } = this.host.state();
    const vars = (track?.layers.map((l) => l.def.variable) ?? [PITCH_VAR[experience]]).filter((v): v is Var => v in SLIDERS);
    const box = $("lab-sliders");
    box.innerHTML = "";
    for (const v of vars) {
      const s = SLIDERS[v];
      const r = ABSOLUTE_RANGE[v];
      const id = `lab-${v}`;
      const val = this.wi[v] ?? (r.min + r.max) / 2;
      this.wi[v] = val;
      const wrap = document.createElement("div");
      wrap.className = "slider";
      wrap.innerHTML =
        `<label for="${id}">${esc(s.label)}${s.unit ? ` (${esc(s.unit)})` : ""}</label><output for="${id}" id="${id}-out">${val.toFixed(2)}</output>` +
        `<input type="range" id="${id}" min="${r.min}" max="${r.max}" step="${s.step}" value="${val}" aria-describedby="${id}-help" />` +
        `<span class="help" id="${id}-help">${esc(s.help)} Last real measurement: ${this.real[v] !== undefined ? esc(this.real[v]!.toFixed(2)) : "none"}.</span>`;
      const input = wrap.querySelector("input")!;
      input.addEventListener("input", () => {
        this.wi[v] = +input.value;
        (wrap.querySelector("output") as HTMLOutputElement).value = (+input.value).toFixed(2);
        input.setAttribute("aria-valuetext", `${(+input.value).toFixed(2)} ${s.unit} (make-believe)`);
        this.renderWhatIfTable(vars);
      });
      box.appendChild(wrap);
    }
    for (const id of ["lab-wi-real", "lab-wi-ab"]) ($(id) as HTMLButtonElement).disabled = !Object.keys(this.real).length;
    this.renderWhatIfTable(vars);
  }

  private describe(vals: Values) {
    const exp = this.host.state().experience;
    const lvl = (k: Var) => (vals[k] === undefined ? null : Math.min(1, Math.max(0, (vals[k]! - ABSOLUTE_RANGE[k].min) / (ABSOLUTE_RANGE[k].max - ABSOLUTE_RANGE[k].min))));
    const p = lvl(PITCH_VAR[exp]);
    const note = p === null ? null : noteIndex(p);
    const dens = lvl("PRECTOTCORR");
    const bright = lvl("ALLSKY_SFC_SW_DWN");
    const harm = vals.SSTA !== undefined ? harmonyIntervals({ kind: "anomaly", anomaly: vals.SSTA }).label : vals.EVI !== undefined ? harmonyIntervals({ kind: "chord", level01: lvl("EVI") ?? 0 }).label : null;
    return { note, noteLabel: note === null ? "silent" : noteName(noteFrequency(exp, note)), hits: dens === null ? null : densityHits(dens), bright: bright === null ? null : Math.round(bright * 100), harm };
  }

  private renderWhatIfTable(vars: Var[]) {
    const A = this.describe(this.real);
    const B = this.describe(this.wi);
    const rows = [`<thead><tr><th scope="col"></th><th scope="col">Real (last measurement)</th><th scope="col">What if (make-believe)</th></tr></thead><tbody>`];
    for (const v of vars) {
      const u = SLIDERS[v].unit;
      const f = (x: number | undefined) => (x === undefined ? "none" : `${x.toFixed(2)}${u ? ` ${u}` : ""}`);
      rows.push(`<tr><th scope="row">${esc(SLIDERS[v].label)}</th><td>${esc(f(this.real[v]))}</td><td>${esc(f(this.wi[v]))}</td></tr>`);
    }
    rows.push(`<tr><th scope="row">Melody note</th><td>${esc(A.noteLabel)}</td><td>${esc(B.noteLabel)}</td></tr>`);
    if (A.hits !== null || B.hits !== null) rows.push(`<tr><th scope="row">Rain beats per note</th><td>${A.hits ?? "—"}</td><td>${B.hits ?? "—"}</td></tr>`);
    if (A.bright !== null || B.bright !== null) rows.push(`<tr><th scope="row">Brightness</th><td>${A.bright ?? "—"}%</td><td>${B.bright ?? "—"}%</td></tr>`);
    if (A.harm || B.harm) rows.push(`<tr><th scope="row">Harmony</th><td>${esc(KID.harmony(A.harm ?? ""))}</td><td>${esc(KID.harmony(B.harm ?? ""))}</td></tr>`);
    $("lab-wi-table").innerHTML = rows.join("") + "</tbody>";
    const out: string[] = [];
    if (A.note !== null && B.note !== null && A.note !== B.note) out.push(`Your “what if” melody is ${Math.abs(B.note - A.note)} step${Math.abs(B.note - A.note) > 1 ? "s" : ""} ${B.note > A.note ? "higher" : "lower"}.`);
    if (A.hits !== null && B.hits !== null && A.hits !== B.hits) out.push(`Rain beats change from ${A.hits} to ${B.hits} per note.`);
    if (A.bright !== null && B.bright !== null && A.bright !== B.bright) out.push(`The sound is ${B.bright > A.bright ? "brighter" : "duller"}.`);
    out.push("<em>Make-believe values change only the sound. They are not measurements and not a prediction.</em>");
    $("lab-wi-explain").innerHTML = out.map((x) => `<p>${x}</p>`).join("");
  }

  private async playValues(clips: [string, Values][]) {
    this.stop();
    await this.host.beforePlay();
    const { experience, palette, layers } = this.host.state();
    const step = 0.3;
    const frames = clips.flatMap(([, v]) => labFrames(v, PITCH_VAR[experience], 8));
    let i = 0;
    const tick = () => {
      if (i % 8 === 0) {
        const name = clips[i / 8][0];
        announce(name === "Real" ? "Playing the real measurement" : "Playing your make-believe values");
        $("lab-now").textContent = name === "Real" ? "▶ Real measurement" : "▶ What if (make-believe)";
      }
      this.engine.play({ ...frames[i], index: i }, step, { experience, palette, layers });
      i++;
      this.timer = i < frames.length ? window.setTimeout(tick, step * 1000) : window.setTimeout(() => this.stop(), 1200);
    };
    tick();
  }
}
