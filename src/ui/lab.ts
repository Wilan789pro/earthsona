import type { SonificationEngine, LayerToggles } from "../audio/engine";
import type { Track } from "../data/registry";
import type { ExperienceId } from "../data/types";
import type { CleanPoint } from "../data/normalise";
import { labFrames } from "../sonification/frames";
import { ABSOLUTE_RANGE, densityHits, harmonyIntervals, noteFrequency, noteIndex, noteName } from "../sonification/mappings";
import type { PaletteId } from "../sonification/palettes";
import { $, announce, esc } from "./dom";
import { fmtDate } from "./format";

/**
 * Earth Sound Lab — "Try this out".
 *  Mode 1 · Real Earth data: values are an actual observation (date picker), read-only, with source.
 *  Mode 2 · Hypothetical scenario: the user moves sliders; everything is labelled SIMULATED.
 * A = the observation, B = the scenario. Each slider only changes its own sound layer — the lab never
 * implies that one variable causes another, and a scenario is not a forecast.
 */
type Var = "T2M" | "PRECTOTCORR" | "ALLSKY_SFC_SW_DWN" | "NDVI" | "EVI" | "SST" | "SSTA";
type Values = Partial<Record<Var, number>>;

const SLIDERS: Record<Var, { label: string; unit: string; step: number; help: string }> = {
  T2M: { label: "Air temperature at 2 m", unit: "°C", step: 0.1, help: "Controls the melody note (pitch)." },
  PRECTOTCORR: { label: "Rainfall", unit: "mm/day", step: 0.1, help: "Controls rhythmic density: 0 to 4 hits per note." },
  ALLSKY_SFC_SW_DWN: { label: "Sunlight at the surface", unit: "MJ/m²/day", step: 0.1, help: "Controls brightness (tone colour)." },
  NDVI: { label: "Vegetation greenness (NDVI)", unit: "", step: 0.01, help: "Controls the melody note and the fullness of the background pad." },
  EVI: { label: "Enhanced vegetation index (EVI)", unit: "", step: 0.01, help: "Controls the harmony: thin octave → open fifth → full chord." },
  SST: { label: "Sea surface temperature", unit: "°C", step: 0.1, help: "Controls the melody note (pitch)." },
  SSTA: { label: "Sea surface temperature anomaly", unit: "°C", step: 0.05, help: "Controls the harmony: calm near 0, more tension further from the baseline." },
};
const PITCH_VAR: Record<ExperienceId, Var> = { pulse: "T2M", forest: "NDVI", ocean: "SST" };

export interface LabContext {
  experience: ExperienceId;
  track: Track | null;
  palette: PaletteId;
  layers: LayerToggles;
}

export class SoundLab {
  private mode: "real" | "hypo" = "real";
  private a: Values = {};
  private b: Values = {};
  private vars: Var[] = [];
  private timer: number | null = null;
  private dateIndex = 0;

  constructor(
    private engine: SonificationEngine,
    private ctx: () => LabContext,
    private beforePlay: () => Promise<void>,
  ) {
    $("lab-mode").querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
      b.addEventListener("click", () => this.setMode(b.dataset.mode as "real" | "hypo")),
    );
    $<HTMLSelectElement>("lab-date").addEventListener("change", (e) => {
      this.dateIndex = +(e.target as HTMLSelectElement).value;
      this.readObservation();
      if (this.mode === "real") this.b = { ...this.a };
      this.render();
    });
    $("lab-play-a").addEventListener("click", () => this.play([["A", this.a]]));
    $("lab-play-b").addEventListener("click", () => this.play([["B", this.b]]));
    $("lab-play-ab").addEventListener("click", () => this.play([["A", this.a], ["B", this.b]]));
  }

  /** Call whenever the experience / place / period changes. */
  refresh(): void {
    const { track, experience } = this.ctx();
    this.vars = (track?.layers.map((l) => l.def.variable) ?? [PITCH_VAR[experience]]).filter((v): v is Var => v in SLIDERS);
    const sel = $<HTMLSelectElement>("lab-date");
    sel.innerHTML = "";
    const pts = this.axis();
    pts.forEach((p, i) => {
      if (p.value === null) return;
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = fmtDate(p.time, { points: pts }, true);
      sel.appendChild(o);
    });
    // Default: the most recent valid observation.
    const lastValid = [...pts.keys()].reverse().find((i) => pts[i].value !== null) ?? 0;
    this.dateIndex = lastValid;
    sel.value = String(lastValid);
    this.readObservation();
    this.b = { ...this.a };
    this.render();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private axis(): CleanPoint[] {
    const t = this.ctx().track;
    return (t?.layers[0]?.result.series.points as CleanPoint[]) ?? [];
  }

  private readObservation(): void {
    const t = this.ctx().track;
    const time = this.axis()[this.dateIndex]?.time;
    this.a = {};
    if (!t || !time) return;
    for (const l of t.layers) {
      const v = l.def.variable as Var;
      const p = (l.result.series.points as CleanPoint[]).reduce<CleanPoint | null>(
        (best, q) => (!best || Math.abs(Date.parse(q.time) - Date.parse(time)) < Math.abs(Date.parse(best.time) - Date.parse(time)) ? q : best),
        null,
      );
      if (p && p.value !== null) this.a[v] = p.value;
    }
  }

  private setMode(m: "real" | "hypo"): void {
    this.mode = m;
    $("lab-mode").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    if (m === "real") this.b = { ...this.a };
    this.render();
    announce(m === "real" ? "Real Earth data mode. Values are an actual observation." : "Hypothetical scenario mode. Values you set are simulated.");
  }

  private render(): void {
    const { track } = this.ctx();
    const layerOrigin = track?.layers[0]?.result;
    const realIsSimulated = layerOrigin?.series.source.kind === "simulated";
    const time = this.axis()[this.dateIndex]?.time;
    const banner = $("lab-banner");
    if (this.mode === "real") {
      banner.className = "lab-banner real";
      banner.innerHTML = realIsSimulated
        ? `<strong>Observation A</strong> — note: no NASA data is loaded for this place, so A is <strong>simulated demonstration data</strong>.`
        : `<strong>Real Earth data.</strong> A is the observation for ${esc(time ? fmtDate(time, { points: this.axis() }, true) : "—")} from ${esc(layerOrigin?.series.source.name ?? "")}. Switch to mode 2 to try other values.`;
    } else {
      banner.className = "lab-banner hypo";
      banner.innerHTML = `<strong>Hypothetical scenario (simulated values).</strong> Moving a slider changes only the sound. It does not change real conditions and is not a forecast.`;
    }
    $("lab-date-wrap").hidden = false;

    const box = $("lab-sliders");
    box.innerHTML = "";
    for (const v of this.vars) {
      const s = SLIDERS[v];
      const r = ABSOLUTE_RANGE[v];
      const id = `lab-${v}`;
      const val = this.b[v] ?? this.a[v] ?? (r.min + r.max) / 2;
      const wrap = document.createElement("div");
      wrap.className = "slider";
      wrap.innerHTML =
        `<label for="${id}">${esc(s.label)}${s.unit ? ` (${esc(s.unit)})` : ""}</label><output for="${id}" id="${id}-out">${val.toFixed(2)}</output>` +
        `<input type="range" id="${id}" min="${r.min}" max="${r.max}" step="${s.step}" value="${val}" ${this.mode === "real" ? "disabled" : ""} aria-describedby="${id}-help" />` +
        `<span class="help" id="${id}-help">${esc(s.help)} Observation A: ${this.a[v] !== undefined ? esc(this.a[v]!.toFixed(2)) : "no data"}.</span>`;
      const input = wrap.querySelector("input")!;
      input.addEventListener("input", () => {
        this.b[v] = +input.value;
        (wrap.querySelector("output") as HTMLOutputElement).value = (+input.value).toFixed(2);
        input.setAttribute("aria-valuetext", `${(+input.value).toFixed(2)} ${s.unit}`);
        this.renderCompare();
      });
      box.appendChild(wrap);
    }
    $<HTMLButtonElement>("lab-play-b").disabled = this.mode === "real";
    $<HTMLButtonElement>("lab-play-ab").disabled = this.mode === "real";
    this.renderCompare();
  }

  private describe(vals: Values) {
    const exp = this.ctx().experience;
    const pv = PITCH_VAR[exp];
    const lvl = (k: Var) => (vals[k] === undefined ? null : Math.min(1, Math.max(0, (vals[k]! - ABSOLUTE_RANGE[k].min) / (ABSOLUTE_RANGE[k].max - ABSOLUTE_RANGE[k].min))));
    const p = lvl(pv);
    const note = p === null ? null : noteIndex(p);
    const dens = lvl("PRECTOTCORR");
    const bright = lvl("ALLSKY_SFC_SW_DWN");
    const harm = vals.SSTA !== undefined ? harmonyIntervals({ kind: "anomaly", anomaly: vals.SSTA }).label : vals.EVI !== undefined ? harmonyIntervals({ kind: "chord", level01: lvl("EVI") ?? 0 }).label : null;
    return {
      note,
      noteLabel: note === null ? "silent (no data)" : `${noteName(noteFrequency(exp, note))} (step ${note + 1} of 11)`,
      hits: dens === null ? null : densityHits(dens),
      bright: bright === null ? null : Math.round(bright * 100),
      harm,
    };
  }

  private renderCompare(): void {
    const A = this.describe(this.a);
    const B = this.describe(this.b);
    const pv = PITCH_VAR[this.ctx().experience];
    const rows: string[] = [`<thead><tr><th scope="col"></th><th scope="col">A · Observation</th><th scope="col">B · ${this.mode === "real" ? "Same as A" : "Scenario (simulated)"}</th></tr></thead><tbody>`];
    for (const v of this.vars) {
      const u = SLIDERS[v].unit;
      const f = (x: number | undefined) => (x === undefined ? "no data" : `${x.toFixed(2)}${u ? ` ${u}` : ""}`);
      rows.push(`<tr><th scope="row">${esc(SLIDERS[v].label)}</th><td>${esc(f(this.a[v]))}</td><td>${esc(f(this.b[v]))}</td></tr>`);
    }
    rows.push(`<tr><th scope="row">Melody note</th><td>${esc(A.noteLabel)}</td><td>${esc(B.noteLabel)}</td></tr>`);
    if (A.hits !== null || B.hits !== null) rows.push(`<tr><th scope="row">Rhythm hits / note</th><td>${A.hits ?? "—"}</td><td>${B.hits ?? "—"}</td></tr>`);
    if (A.bright !== null || B.bright !== null) rows.push(`<tr><th scope="row">Brightness</th><td>${A.bright ?? "—"}%</td><td>${B.bright ?? "—"}%</td></tr>`);
    if (A.harm || B.harm) rows.push(`<tr><th scope="row">Harmony</th><td>${esc(A.harm ?? "—")}</td><td>${esc(B.harm ?? "—")}</td></tr>`);
    $("lab-compare").innerHTML = rows.join("") + "</tbody>";

    const out: string[] = [];
    if (this.mode === "real") {
      out.push("Switch to <strong>Hypothetical scenario</strong> to change values and compare B with this observation.");
    } else {
      const d = (this.b[pv] ?? 0) - (this.a[pv] ?? 0);
      if (A.note !== null && B.note !== null && A.note !== B.note) {
        out.push(`B's ${esc(SLIDERS[pv].label.toLowerCase())} is ${Math.abs(d).toFixed(2)} ${esc(SLIDERS[pv].unit)} ${d > 0 ? "higher" : "lower"}, so the melody moves ${Math.abs(B.note - A.note)} scale step${Math.abs(B.note - A.note) > 1 ? "s" : ""} ${B.note > A.note ? "up" : "down"}.`);
      } else if (A.note === B.note) out.push("The melody note is the same: the change is too small to reach the next note on the scale.");
      if (A.hits !== null && B.hits !== null && A.hits !== B.hits) out.push(`Rainfall changes the rhythm from ${A.hits} to ${B.hits} hits per note.`);
      if (A.bright !== null && B.bright !== null && A.bright !== B.bright) out.push(`Sunlight makes B ${B.bright > A.bright ? "brighter" : "darker"} (${A.bright}% → ${B.bright}%).`);
      if (A.harm && B.harm && A.harm !== B.harm) out.push(`Harmony changes from “${esc(A.harm)}” to “${esc(B.harm)}”.`);
      out.push("<em>Each slider only changes its own sound layer. EARTHSONA does not model how these variables affect each other, and a scenario is not a forecast.</em>");
    }
    $("lab-explain").innerHTML = out.map((x) => `<p>${x}</p>`).join("");
  }

  private async play(clips: [string, Values][]): Promise<void> {
    this.stop();
    await this.beforePlay();
    const { experience, palette, layers } = this.ctx();
    const step = 0.25;
    const frames = clips.flatMap(([, v]) => labFrames(v, PITCH_VAR[experience], 8));
    let i = 0;
    const tick = () => {
      if (i % 8 === 0) announce(`Playing ${clips[i / 8][0] === "A" ? "A, the observation" : "B, the simulated scenario"}`);
      this.engine.play({ ...frames[i], index: i }, step, { experience, palette, layers });
      i++;
      this.timer = i < frames.length ? window.setTimeout(tick, step * 1000) : null;
    };
    tick();
  }
}
