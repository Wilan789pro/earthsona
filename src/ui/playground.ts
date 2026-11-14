import type { LayerToggles, SonificationEngine } from "../audio/engine";
import type { Track } from "../data/registry";
import type { CleanPoint } from "../data/normalise";
import type { ExperienceId, RegionDef } from "../data/types";
import { labFrames, trackToFrames, type SoundFrame } from "../sonification/frames";
import type { PaletteId } from "../sonification/palettes";
import type { Pretend } from "../globeThemes";
import { PRESETS, VARS, baselineOf, changesFromBaseline, fmt, simulate, type SimResult, type Values } from "../lab/simulation";
import { $, announce, esc } from "./dom";
import { fmtDate, fmtValue } from "./format";
import { KID, timeWindows, type TimeWindow } from "./kid";
import { lunaSvg, type Luna } from "./luna";

/**
 * The mission laboratory ("Try this out"), opened by tapping Luna.
 *  Experiment: six interacting variables per mission (src/lab/simulation.ts). The scene and the globe change
 *  gradually; health indicators compare against the baseline; explanations depend on the exact combination.
 *  Everything here is a simplified educational SIMULATION, kept visibly apart from the real NASA data.
 *  Two real years: plays two real periods with the same rules and describes the difference (not the cause).
 */
type RealVar = "SST" | "SSTA" | "NDVI" | "EVI" | "T2M" | "PRECTOTCORR" | "ALLSKY_SFC_SW_DWN";
type Vals = Partial<Record<RealVar, number>>;

export interface LabSnapshot {
  mission: ExperienceId;
  values: Values;
  baseline: Values;
  result: SimResult;
  baselineResult: SimResult;
}

export interface PlaygroundHost {
  state: () => { experience: ExperienceId; region: RegionDef; track: Track | null; palette: PaletteId; layers: LayerToggles };
  luna: Luna;
  engine: SonificationEngine;
  pretendGlobe: (p: Pretend | null, rain?: number, sun?: number) => void;
  /** Show the animated environment (true) or the globe (false) in the stage. */
  showScene: (visual: Record<string, number> | null, instant?: boolean) => void;
  askLuna: (message: string) => void;
  beforePlay: () => Promise<void>;
  afterPlay: () => void;
  onClose: () => void;
}

const PITCH_VAR: Record<ExperienceId, RealVar> = { ocean: "SST", forest: "NDVI", pulse: "T2M" };
const TITLE: Record<ExperienceId, string> = { forest: "Forest lab", ocean: "Ocean lab", pulse: "Earth's Pulse lab" };
/** Child-friendly label + icon for every lab variable (the scientific name stays in Grown-up details). */
const FRIENDLY: Record<string, { icon: string; name: string }> = {
  "forest.sun": { icon: "☀️", name: "Sunshine" },
  "forest.rain": { icon: "🌧️", name: "Rain" },
  "forest.humidity": { icon: "💧", name: "Damp air" },
  "forest.temp": { icon: "🌡️", name: "Heat" },
  "forest.co2": { icon: "🫧", name: "CO₂ gas" },
  "forest.soil": { icon: "🟫", name: "Wet soil" },
  "ocean.sst": { icon: "🌡️", name: "Sea warmth" },
  "ocean.ph": { icon: "🧪", name: "Sea acidity" },
  "ocean.oxygen": { icon: "🫧", name: "Oxygen" },
  "ocean.pollution": { icon: "🗑️", name: "Rubbish" },
  "ocean.nutrients": { icon: "🌱", name: "Plant food" },
  "ocean.reef": { icon: "🪸", name: "Coral reef" },
  "pulse.temp": { icon: "🌡️", name: "Earth's warmth" },
  "pulse.co2": { icon: "🏭", name: "CO₂ in the air" },
  "pulse.ice": { icon: "🧊", name: "Ice" },
  "pulse.sea": { icon: "🌊", name: "Sea level" },
  "pulse.veg": { icon: "🌳", name: "Plants" },
  "pulse.extreme": { icon: "⛈️", name: "Wild weather" },
};
const FEEL: Record<ExperienceId, string> = { forest: "How is the forest feeling?", ocean: "How is the reef feeling?", pulse: "How is our planet feeling?" };
const face = (h: number) => (h >= 80 ? "😄" : h >= 60 ? "🙂" : h >= 40 ? "😐" : h >= 20 ? "😟" : "😢");
/** "less / normal / more" in words, relative to the baseline. */
function amount(x: number, d: { min: number; max: number; baseline: number }): string {
  const span = x >= d.baseline ? d.max - d.baseline : d.baseline - d.min;
  const r = span ? (x - d.baseline) / span : 0;
  return Math.abs(r) < 0.08 ? "normal" : r > 0.6 ? "lots more" : r > 0 ? "more" : r < -0.6 ? "much less" : "less";
}

export class Playground {
  open = false;
  private v: Values = {};
  private real: Vals = {};
  private realDates: Partial<Record<RealVar, string>> = {};
  private timer: number | null = null;
  private tween = 0;
  private tab: "lab" | "years" = "lab";
  private view: "scene" | "globe" = "scene";
  private comparing = false;
  private windows: TimeWindow[] = [];
  private a = "";
  private b = "";
  private raf = 0;
  private exp: ExperienceId = "forest";

  constructor(private host: PlaygroundHost) {}

  /** Current experiment, for Luna's context (null when the lab is closed). */
  snapshot(): LabSnapshot | null {
    if (!this.open) return null;
    const base = baselineOf(this.exp);
    return { mission: this.exp, values: { ...this.v }, baseline: base, result: simulate(this.exp, this.v), baselineResult: simulate(this.exp, base) };
  }

  show(): void {
    this.open = true;
    this.exp = this.host.state().experience;
    this.v = baselineOf(this.exp);
    $("real-panel").hidden = true;
    $("playground").hidden = false;
    this.render();
    this.update(true);
    this.host.luna.say(
      {
        forest: "Welcome to the Living Forest lab! Change sunlight, rain, humidity, temperature, CO₂ and soil moisture, and watch how the forest responds. Everything here is a simplified simulation.",
        ocean: "Welcome to the Living Ocean lab! Adjust temperature, acidity, oxygen, pollution, nutrients and reef health, and see how the reef reacts. Remember, this is a simulation.",
        pulse: "Welcome to the Earth Pulse lab! Explore how temperature, CO₂, ice, sea level, vegetation and extreme weather connect. It's a simplified model, not a forecast.",
      }[this.exp],
      { mood: "wow" },
    );
    (document.querySelector("#playground input[type=range]") as HTMLElement | null)?.focus();
  }

  close(): void {
    this.stop();
    cancelAnimationFrame(this.tween);
    this.open = false;
    $("playground").hidden = true;
    $("real-panel").hidden = false;
    $("pretend-tag").hidden = true;
    this.host.pretendGlobe(null);
    this.host.showScene(null);
    this.host.onClose();
  }

  refresh(): void {
    if (!this.open) return;
    const exp = this.host.state().experience;
    if (exp !== this.exp) {
      this.exp = exp;
      this.v = baselineOf(exp);
    }
    this.render();
    this.update(true);
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.host.afterPlay();
    }
  }

  // ---------------------------------------------------------------------------
  private readReal() {
    const { track } = this.host.state();
    this.real = {};
    this.realDates = {};
    for (const l of track?.layers ?? []) {
      const pts = (l.result.series.points as CleanPoint[]).filter((p) => p.value !== null && !p.bridged);
      const last = pts[pts.length - 1];
      if (last) {
        this.real[l.def.variable as RealVar] = last.value as number;
        this.realDates[l.def.variable as RealVar] = fmtDate(last.time, l.result.series, true);
      }
    }
  }

  private render() {
    const { region, track } = this.host.state();
    const exp = this.exp;
    this.readReal();
    const axis = (track?.layers[0].result.series.points ?? []) as CleanPoint[];
    this.windows = timeWindows(axis.map((p) => p.time)).filter((w) => w.key !== "all");
    const keys = this.windows.map((w) => w.key);
    if (!keys.includes(this.a)) this.a = keys[0] ?? "";
    if (!keys.includes(this.b) || this.b === this.a) this.b = keys[keys.length - 1] ?? "";
    const pv = PITCH_VAR[exp];
    const pitch = track?.layers.find((l) => l.def.variable === pv)?.result.series;
    const realLine = pitch && this.real[pv] !== undefined
      ? `${KID.label(pv)} at ${esc(region.short ?? region.name)}: <strong>${esc(fmtValue(this.real[pv]!, pitch.unit))}</strong> (${esc(this.realDates[pv] ?? "")}, ${esc(pitch.source.kind === "noaa" ? "NOAA" : "NASA")})`
      : "No real measurements are loaded for this place.";

    const sliders = VARS[exp]
      .map((d) => {
        const f = FRIENDLY[`${exp}.${d.key}`] ?? { icon: "•", name: d.label };
        const pct = ((d.baseline - d.min) / (d.max - d.min)) * 100;
        return `<div class="kid-var">
          <span class="kid-ico" aria-hidden="true">${f.icon}</span>
          <label for="lv-${d.key}">${esc(f.name)}</label>
          <div class="lab-range" style="--base:${pct}%">
            <input type="range" id="lv-${d.key}" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${this.v[d.key]}" title="${esc(d.help)}" />
            <span class="base-tick" aria-hidden="true"></span>
          </div>
          <output id="lv-${d.key}-word" class="kid-word">${amount(this.v[d.key], d)}</output>
        </div>`;
      })
      .join("");
    const grown = VARS[exp]
      .map((d) => `<tr><th scope="row">${esc(d.label)}</th><td><output id="lv-${d.key}-out">${esc(fmt(this.v[d.key], d))}</output></td><td>${esc(fmt(d.min, d))} – ${esc(fmt(d.max, d))}</td><td>${esc(fmt(d.baseline, d))}</td></tr>`)
      .join("");

    const box = $("playground");
    box.innerHTML = `
      <div class="pg-head">
        <span class="pg-luna" aria-hidden="true">${lunaSvg("curious", 52)}</span>
        <div><h2 id="pg-title" class="side-h">${TITLE[exp]}</h2><p class="small muted">${esc(region.short ?? region.name)}</p></div>
        <button class="round" id="pg-close" title="Back to the real Earth"><svg aria-hidden="true"><use href="#i-close" /></svg><span class="sr-only">Close the lab</span></button>
      </div>
      <div class="tabs small-tabs" role="tablist" aria-label="Lab">
        <button role="tab" id="pg-tab-lab" aria-selected="${this.tab === "lab"}" aria-controls="pg-lab">Experiment</button>
        <button role="tab" id="pg-tab-years" aria-selected="${this.tab === "years"}" aria-controls="pg-years">Two real years</button>
      </div>
      <section id="pg-lab" role="tabpanel" ${this.tab === "lab" ? "" : "hidden"}>
        <p class="kid-note">Move a slider and watch what happens! This is a pretend world for experimenting.</p>
        <div class="kid-vars">${sliders}</div>
        <div class="feel-card" aria-live="polite">
          <span class="feel-face" id="lab-face" aria-hidden="true">😄</span>
          <div class="feel-body">
            <span class="feel-q">${FEEL[exp]}</span>
            <div class="meter big"><span id="lab-health-bar"></span><i id="lab-health-base" title="normal"></i></div>
            <strong id="lab-health" class="small">–</strong>
          </div>
        </div>
        <div class="lab-actions">
          <button class="pill primary" id="lab-play">▶ Listen</button>
          <button class="pill" id="lab-ask">Ask Luna</button>
          <button class="pill quiet" id="lab-reset">↺ Back to normal</button>
        </div>
        <p class="lab-try small"><strong>Try:</strong> ${PRESETS[exp].slice(0, 3).map((p, i) => `<button class="chip" data-preset="${i}">${esc(p.label.replace(/^…/, ""))}</button>`).join(" ")}</p>
        <details class="grown">
          <summary>Grown-up details</summary>
          <div class="data-split">
            <p class="obs"><span class="kind-tag k-measured">Observed data</span> ${realLine}</p>
            <p class="sim"><span class="kind-tag k-sim">Simulation</span> Simplified educational model. Not a NASA observation, not a forecast.</p>
          </div>
          <div class="table-scroll flat"><table class="mapping"><thead><tr><th>Variable</th><th>Now</th><th>Range</th><th>Normal</th></tr></thead><tbody>${grown}</tbody></table></div>
          <div id="lab-indicators" class="indicators"></div>
          <h4>What's happening</h4>
          <ul id="lab-findings" class="findings"></ul>
          <div class="lab-actions">
            <button class="pill small" id="lab-compare" aria-pressed="false">Compare with normal</button>
            <button class="pill small quiet" id="lab-view">${this.view === "scene" ? "Show on globe" : "Show the picture"}</button>
          </div>
        </details>
      </section>
      <section id="pg-years" role="tabpanel" ${this.tab === "years" ? "" : "hidden"}>
        <p class="small">Both are real measurements, played with the same sound rules.</p>
        ${this.windows.length < 2 ? `<p>Only one time is available here.</p>` : `
        <div class="ab-row"><span class="ab-tag a">A</span><div class="chips" role="radiogroup" aria-label="Time A">${this.windows.map((w) => `<button class="chip" role="radio" aria-checked="${w.key === this.a}" data-a="${esc(w.key)}">${esc(w.label)}</button>`).join("")}</div></div>
        <div class="ab-row"><span class="ab-tag b">B</span><div class="chips" role="radiogroup" aria-label="Time B">${this.windows.map((w) => `<button class="chip" role="radio" aria-checked="${w.key === this.b}" data-b="${esc(w.key)}">${esc(w.label)}</button>`).join("")}</div></div>
        <div class="pg-buttons"><button class="pill" id="pg-a">▶ A</button><button class="pill" id="pg-b">▶ B</button><button class="pill primary" id="pg-ab">▶ A then B</button></div>`}
      </section>`;

    $("pg-close").onclick = () => this.close();
    $("pg-tab-lab").onclick = () => ((this.tab = "lab"), this.stop(), this.render(), this.update(true));
    $("pg-tab-years").onclick = () => {
      this.tab = "years";
      this.stop();
      this.render();
      this.host.showScene(null);
      this.host.pretendGlobe(null);
      $("pretend-tag").hidden = true;
      this.host.luna.say("Pick two real time periods, A and B, and listen to both. Both are real measurements.");
    };
    box.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((input) => {
      input.oninput = () => {
        cancelAnimationFrame(this.tween);
        this.v[input.dataset.key!] = +input.value;
        this.update();
      };
      input.onchange = () => this.narrate();
    });
    box.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) => (b.onclick = () => this.applyPreset(+b.dataset.preset!)));
    document.getElementById("lab-reset")?.addEventListener("click", () => this.animateTo(baselineOf(exp), "Back to normal!"));
    document.getElementById("lab-play")?.addEventListener("click", () => this.playExperiment());
    document.getElementById("lab-ask")?.addEventListener("click", () => {
      const ch = changesFromBaseline(exp, this.v);
      this.host.askLuna(ch.length ? `I changed ${ch.join("; ")}. What is happening to the ${exp === "pulse" ? "climate system" : exp} and why?` : "I'm at the baseline. What should I try changing first, and what do you expect to happen?");
    });
    document.getElementById("lab-compare")?.addEventListener("click", (e) => {
      this.comparing = !this.comparing;
      (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(this.comparing));
      (e.currentTarget as HTMLElement).textContent = this.comparing ? "Back to my experiment" : "Compare with normal";
      this.update();
      announce(this.comparing ? "Showing the baseline" : "Showing your experiment");
    });
    document.getElementById("lab-view")?.addEventListener("click", () => {
      this.view = this.view === "scene" ? "globe" : "scene";
      this.render();
      this.update(true);
    });
    box.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => ((this.a = b.dataset.a!), this.render())));
    box.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => ((this.b = b.dataset.b!), this.render())));
    document.getElementById("pg-a")?.addEventListener("click", () => this.playYears(["A"]));
    document.getElementById("pg-b")?.addEventListener("click", () => this.playYears(["B"]));
    document.getElementById("pg-ab")?.addEventListener("click", () => this.playYears(["A", "B"]));
  }

  /** Recompute the simulation and refresh meters, findings, scene and globe. */
  private update(instant = false) {
    if (this.tab !== "lab") return;
    const exp = this.exp;
    const base = baselineOf(exp);
    const shown = this.comparing ? base : this.v;
    const r = simulate(exp, shown);
    const rb = simulate(exp, base);
    for (const d of VARS[exp]) {
      const out = document.getElementById(`lv-${d.key}-out`);
      if (out) out.textContent = fmt(this.v[d.key], d);
      const word = document.getElementById(`lv-${d.key}-word`);
      if (word) word.textContent = amount(this.v[d.key], d);
      const inp = document.getElementById(`lv-${d.key}`) as HTMLInputElement | null;
      if (inp && +inp.value !== this.v[d.key]) inp.value = String(this.v[d.key]);
      inp?.setAttribute("aria-valuetext", `${fmt(this.v[d.key], d)}, baseline ${fmt(d.baseline, d)}`);
    }
    const h = document.getElementById("lab-health");
    if (!h) return;
    h.textContent = this.comparing ? `${r.health} out of 100 (normal)` : `${r.health} out of 100 · normal is ${rb.health}`;
    $("lab-face").textContent = face(r.health);
    const bar = $("lab-health-bar");
    bar.style.width = `${r.health}%`;
    bar.style.background = r.health > 66 ? "var(--good)" : r.health > 40 ? "var(--warn)" : "var(--bad)";
    $("lab-health-base").style.left = `${rb.health}%`;
    $("lab-indicators").innerHTML = r.indicators
      .map((ind) => {
        const b = rb.indicators.find((x) => x.key === ind.key)!;
        const bad = ind.good === "high" ? 1 - ind.value : ind.value;
        const col = bad < 0.33 ? "var(--good)" : bad < 0.6 ? "var(--warn)" : "var(--bad)";
        return `<div class="ind"><span class="small">${esc(ind.label)}</span><div class="meter"><span style="width:${Math.round(ind.value * 100)}%;background:${col}"></span><i style="left:${Math.round(b.value * 100)}%" title="baseline"></i></div></div>`;
      })
      .join("");
    $("lab-findings").innerHTML = r.findings.map((f) => `<li>${esc(f)}</li>`).join("");
    const changed = changesFromBaseline(exp, this.v).length > 0 && !this.comparing;
    $("pretend-tag").hidden = !changed;
    $("pretend-tag").textContent = "Simulation";
    if (this.view === "scene") {
      this.host.showScene(r.visual, instant);
      this.host.pretendGlobe(null);
    } else {
      this.host.showScene(null);
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.paintGlobe(r, rb, changed));
    }
  }

  private paintGlobe(r: SimResult, rb: SimResult, changed: boolean) {
    if (!changed) return this.host.pretendGlobe(null);
    const v = this.comparing ? baselineOf(this.exp) : this.v;
    if (this.exp === "ocean") this.host.pretendGlobe({ seaWarmth: v.sst });
    else if (this.exp === "forest") this.host.pretendGlobe({ green: Math.min(1, r.visual.green / Math.max(0.05, rb.visual.green)) });
    else this.host.pretendGlobe({ airWarmth: (v.temp - 1.1) * 3 }, 1 + (v.extreme - 1) * 0.8, 1);
  }

  private narrate() {
    const r = simulate(this.exp, this.v);
    this.host.luna.setMood(r.health < 45 ? "concerned" : r.health > 80 ? "happy" : "thoughtful");
    this.host.luna.say(r.findings[0], { mood: r.health < 45 ? "concerned" : r.health > 80 ? "happy" : "thoughtful" });
  }

  private applyPreset(i: number) {
    const p = PRESETS[this.exp][i];
    this.animateTo({ ...baselineOf(this.exp), ...p.values }, `What happens if ${p.label.replace(/^…/, "")}`);
  }

  /** Move sliders smoothly to a target (gradual change, about 1.5 s). */
  private animateTo(target: Values, label: string) {
    cancelAnimationFrame(this.tween);
    this.comparing = false;
    const from = { ...this.v };
    const t0 = performance.now();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const k = reduce ? 1 : Math.min(1, (performance.now() - t0) / 1500);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      for (const key of Object.keys(target)) this.v[key] = from[key] + (target[key] - from[key]) * e;
      if (k >= 1) for (const d of VARS[this.exp]) this.v[d.key] = Math.round(target[d.key] / d.step) * d.step;
      this.update();
      if (k < 1) this.tween = requestAnimationFrame(tick);
      else {
        const r = simulate(this.exp, this.v);
        this.host.luna.say(`${label} ${r.findings[0]}`, { mood: r.health < 45 ? "concerned" : r.health > 80 ? "happy" : "surprised" });
      }
    };
    tick();
  }

  /** Sound for the experiment: the simulation's outputs shift the latest REAL value (labelled as simulation). */
  private experimentValues(): Vals {
    const exp = this.exp;
    const r = simulate(exp, this.v);
    const rb = simulate(exp, baselineOf(exp));
    const v: Vals = { ...this.real };
    if (exp === "forest") {
      const f = Math.min(1.2, r.visual.green / Math.max(0.05, rb.visual.green));
      if (v.NDVI !== undefined) v.NDVI *= f;
      if (v.EVI !== undefined) v.EVI *= f;
    } else if (exp === "ocean") {
      if (v.SST !== undefined) v.SST += this.v.sst;
      if (v.SSTA !== undefined) v.SSTA += this.v.sst;
    } else {
      if (v.T2M !== undefined) v.T2M += this.v.temp - 1.1;
      if (v.PRECTOTCORR !== undefined) v.PRECTOTCORR *= 0.5 + 0.5 * this.v.extreme;
    }
    return v;
  }

  private async playExperiment() {
    this.stop();
    if (!Object.keys(this.real).length) {
      this.host.luna.say("There are no real measurements here to start the sound from. Try a place with data.");
      return;
    }
    await this.host.beforePlay();
    const { palette, layers } = this.host.state();
    const exp = this.exp;
    const seq = [...labFrames(this.real, PITCH_VAR[exp], 6), ...labFrames(this.real, PITCH_VAR[exp], 2).map((f) => ({ ...f, pitch: null })), ...labFrames(this.experimentValues(), PITCH_VAR[exp], 8)];
    this.host.luna.caption("Listen: first the latest real measurement, then your simulated experiment.");
    let i = 0;
    const tick = () => {
      const f = seq[i];
      if (f.pitch !== null || i === 0) this.host.engine.play({ ...f, index: i }, 0.35, { experience: exp, palette, layers });
      i++;
      if (i < seq.length) this.timer = window.setTimeout(tick, 350);
      else
        this.timer = window.setTimeout(() => {
          this.stop();
          const r = simulate(exp, this.v);
          const ch = changesFromBaseline(exp, this.v);
          this.host.luna.say(ch.length ? `You heard the real sound first, then your experiment. ${r.findings[0]}` : "You heard the baseline twice: nothing has been changed yet. Try a slider or a 'What happens if' scenario.", { repeat: true });
        }, 900);
    };
    tick();
  }

  // --- Two real years -------------------------------------------------------
  private framesFor(key: string): SoundFrame[] {
    const { track } = this.host.state();
    const w = this.windows.find((x) => x.key === key);
    if (!track || !w) return [];
    const all = trackToFrames(track, "absolute").filter((f) => f.time >= w.from && f.time <= w.to);
    return all.map((f, i) => ({ ...f, index: i, pan: all.length > 1 ? (i / (all.length - 1)) * 2 - 1 : 0 }));
  }

  private mean(key: string): { v: number; unit: string } | null {
    const { track, experience } = this.host.state();
    const w = this.windows.find((x) => x.key === key);
    const s = track?.layers.find((l) => l.def.variable === PITCH_VAR[experience])?.result.series;
    if (!s || !w) return null;
    const ok = (s.points as CleanPoint[]).filter((p) => p.time >= w.from && p.time <= w.to && p.value !== null && !p.bridged);
    return ok.length ? { v: ok.reduce((a, p) => a + (p.value as number), 0) / ok.length, unit: s.unit } : null;
  }

  private async playYears(which: ("A" | "B")[]) {
    this.stop();
    const clips = which.map((k) => ({ k, key: k === "A" ? this.a : this.b })).map((c) => ({ ...c, frames: this.framesFor(c.key) })).filter((c) => c.frames.length);
    if (!clips.length) return;
    await this.host.beforePlay();
    const { experience, palette, layers } = this.host.state();
    const step = Math.max(0.1, Math.min(0.35, 7 / Math.max(...clips.map((c) => c.frames.length))));
    const label = (k: string) => this.windows.find((w) => w.key === k)?.label ?? k;
    const seq: { f: SoundFrame; first?: string }[] = [];
    clips.forEach((c, ci) => {
      c.frames.forEach((f, i) => seq.push({ f, first: i === 0 ? `${c.k}: ${label(c.key)}` : undefined }));
      if (ci < clips.length - 1) for (let i = 0; i < 4; i++) seq.push({ f: { ...c.frames[0], pitch: null, harmony: null, density: null, brightness: null, texture: null } });
    });
    let i = 0;
    const tick = () => {
      const s = seq[i];
      if (s.first) this.host.luna.caption(`Listen to ${s.first}`);
      if (s.f.pitch !== null || s.first) this.host.engine.play(s.f, step, { experience, palette, layers });
      i++;
      if (i < seq.length) this.timer = window.setTimeout(tick, step * 1000);
      else this.timer = window.setTimeout(() => (this.stop(), this.sayYears()), 1200);
    };
    tick();
  }

  private sayYears() {
    const { experience } = this.host.state();
    const A = this.mean(this.a);
    const B = this.mean(this.b);
    if (!A || !B) return;
    const la = this.windows.find((w) => w.key === this.a)?.label ?? "";
    const lb = this.windows.find((w) => w.key === this.b)?.label ?? "";
    const d = B.v - A.v;
    const small = Math.abs(d) < (experience === "forest" ? 0.01 : 0.1);
    const what = { ocean: ["warmer", "cooler", "the sea"], forest: ["greener", "less green", "the forest"], pulse: ["warmer", "cooler", "the air"] }[experience];
    const line = small
      ? `In ${lb}, ${what[2]} was about the same as in ${la}, so the tunes sit at the same height.`
      : `On average, ${what[2]} was ${d > 0 ? what[0] : what[1]} in ${lb} than in ${la}: ${fmtValue(B.v, B.unit)} instead of ${fmtValue(A.v, A.unit)}. That's why B's tune sits ${d > 0 ? "higher" : "lower"}.`;
    this.host.luna.say(`${line} These are real measurements; one year can differ from another for many reasons, including weather and seasons.`, { repeat: true });
  }
}
