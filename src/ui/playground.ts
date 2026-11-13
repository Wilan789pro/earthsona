import type { LayerToggles, SonificationEngine } from "../audio/engine";
import type { Track } from "../data/registry";
import type { CleanPoint } from "../data/normalise";
import type { ExperienceId, RegionDef } from "../data/types";
import { labFrames, trackToFrames, type SoundFrame } from "../sonification/frames";
import type { PaletteId } from "../sonification/palettes";
import type { Pretend } from "../globeThemes";
import { $, announce, esc } from "./dom";
import { fmtValue } from "./format";
import { timeWindows, type TimeWindow } from "./kid";
import { lunaSvg, type Luna } from "./luna";

/**
 * Luna's playground ("Try this out").
 *  Pretend: sliders start at the REAL latest measurement for this place. Moving them repaints the globe
 *  (a drawing, labelled "Pretend Earth") and changes the music and the nature sound. Luna then explains
 *  what changed and what could happen in real life — always saying it is pretend, never a forecast.
 *  Two real years: plays two real periods with the same rules and describes the difference (not the cause).
 */
type Var = "SST" | "SSTA" | "NDVI" | "EVI" | "T2M" | "PRECTOTCORR" | "ALLSKY_SFC_SW_DWN";
type Vals = Partial<Record<Var, number>>;

export interface PlaygroundHost {
  state: () => { experience: ExperienceId; region: RegionDef; track: Track | null; palette: PaletteId; layers: LayerToggles };
  luna: Luna;
  engine: SonificationEngine;
  /** Repaint the globe with a pretend change (null = back to the real map). */
  pretendGlobe: (p: Pretend | null, rain?: number, sun?: number) => void;
  beforePlay: () => Promise<void>;
  afterPlay: () => void;
  onClose: () => void;
}

interface Slider {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

const SLIDERS: Record<ExperienceId, Slider[]> = {
  ocean: [{ key: "seaWarmth", label: "How warm is the sea?", min: -3, max: 4, step: 0.5, fmt: (v) => (v === 0 ? "like the real sea" : `${v > 0 ? "+" : "−"}${Math.abs(v)} °C ${v > 0 ? "warmer" : "cooler"}`) }],
  forest: [{ key: "green", label: "How much forest is left?", min: 0, max: 1, step: 0.05, fmt: (v) => (v >= 1 ? "all of it" : v <= 0 ? "none at all" : `${Math.round(v * 100)}%`) }],
  pulse: [
    { key: "rain", label: "How much rain?", min: 0, max: 3, step: 0.25, fmt: (v) => (v === 1 ? "like the real rain" : v === 0 ? "no rain at all" : `${v}× the real rain`) },
    { key: "sun", label: "How much sunshine?", min: 0.25, max: 1.75, step: 0.25, fmt: (v) => (v === 1 ? "like the real sun" : `${v}× the real sunshine`) },
    { key: "airWarmth", label: "How warm is the air?", min: -10, max: 10, step: 1, fmt: (v) => (v === 0 ? "like the real air" : `${v > 0 ? "+" : "−"}${Math.abs(v)} °C`) },
  ],
};
const DEFAULTS: Record<string, number> = { seaWarmth: 0, green: 1, rain: 1, sun: 1, airWarmth: 0 };
const PITCH_VAR: Record<ExperienceId, Var> = { ocean: "SST", forest: "NDVI", pulse: "T2M" };

export class Playground {
  open = false;
  private s: Record<string, number> = { ...DEFAULTS };
  private real: Vals = {};
  private timer: number | null = null;
  private tab: "pretend" | "years" = "pretend";
  private windows: TimeWindow[] = [];
  private a = "";
  private b = "";
  private raf = 0;

  constructor(private host: PlaygroundHost) {}

  show(): void {
    this.open = true;
    this.s = { ...DEFAULTS };
    $("real-panel").hidden = true;
    $("playground").hidden = false;
    $("pretend-tag").hidden = true;
    this.render();
    const { experience } = this.host.state();
    const intro = {
      ocean: "Let's pretend! Move the slider to make the sea warmer or cooler, and watch the Earth change. Then press play to hear it.",
      forest: "Let's pretend! Slide to take the forest away, and watch the land change. Then press play to hear what happens.",
      pulse: "Let's pretend! Change the rain, the sunshine and the warmth, and watch the Earth. Then press play to hear it.",
    }[experience];
    this.host.luna.say(intro, { mood: "wow" });
    ($("playground").querySelector("input, button") as HTMLElement | null)?.focus();
  }

  close(): void {
    this.stop();
    this.open = false;
    $("playground").hidden = true;
    $("real-panel").hidden = false;
    $("pretend-tag").hidden = true;
    this.host.pretendGlobe(null);
    this.host.onClose();
  }

  /** The world, place or data changed while the playground is open. */
  refresh(): void {
    if (!this.open) return;
    this.s = { ...DEFAULTS };
    this.host.pretendGlobe(null);
    $("pretend-tag").hidden = true;
    this.render();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.host.afterPlay();
    }
  }

  // ---------------------------------------------------------------------------
  private render() {
    const { experience, region, track } = this.host.state();
    this.real = {};
    for (const l of track?.layers ?? []) {
      const pts = (l.result.series.points as CleanPoint[]).filter((p) => p.value !== null && !p.bridged);
      const last = pts[pts.length - 1];
      if (last) this.real[l.def.variable as Var] = last.value as number;
    }
    const axis = (track?.layers[0].result.series.points ?? []) as CleanPoint[];
    this.windows = timeWindows(axis.map((p) => p.time)).filter((w) => w.key !== "all");
    const keys = this.windows.map((w) => w.key);
    if (!keys.includes(this.a)) this.a = keys[0] ?? "";
    if (!keys.includes(this.b) || this.b === this.a) this.b = keys[keys.length - 1] ?? "";

    const box = $("playground");
    const sliders = SLIDERS[experience]
      .map(
        (sl) => `<div class="pg-slider">
          <label for="pg-${sl.key}">${esc(sl.label)}</label>
          <input type="range" id="pg-${sl.key}" min="${sl.min}" max="${sl.max}" step="${sl.step}" value="${this.s[sl.key]}" aria-valuetext="${esc(sl.fmt(this.s[sl.key]))}, pretend" />
          <output id="pg-${sl.key}-out" for="pg-${sl.key}">${esc(sl.fmt(this.s[sl.key]))}</output>
        </div>`,
      )
      .join("");
    const noData = !track;
    box.innerHTML = `
      <div class="pg-head">
        <span class="pg-luna" aria-hidden="true">${lunaSvg("wow", 56)}</span>
        <div><h2 id="pg-title" class="side-h">Luna's playground</h2><p class="small muted">${esc(region.short ?? region.name)}</p></div>
        <button class="round" id="pg-close" title="Back to the real Earth"><svg aria-hidden="true"><use href="#i-close" /></svg><span class="sr-only">Back to the real Earth</span></button>
      </div>
      <div class="tabs small-tabs" role="tablist" aria-label="Playground">
        <button role="tab" id="pg-tab-pretend" aria-selected="${this.tab === "pretend"}" aria-controls="pg-pretend">Pretend</button>
        <button role="tab" id="pg-tab-years" aria-selected="${this.tab === "years"}" aria-controls="pg-years">Two real years</button>
      </div>
      <section id="pg-pretend" role="tabpanel" ${this.tab === "pretend" ? "" : "hidden"}>
        <p class="pretend-note">This is make-believe. The real measurements don't change, and it is not a forecast.</p>
        ${noData ? `<p>There are no real measurements for this place to start from. Pick another place.</p>` : sliders}
        <div class="pg-buttons">
          <button class="pill primary" id="pg-play-pretend" ${noData ? "disabled" : ""}>▶ Hear my pretend Earth</button>
          <button class="pill" id="pg-play-real" ${noData ? "disabled" : ""}>▶ Hear the real Earth</button>
          <button class="pill quiet" id="pg-reset" ${noData ? "disabled" : ""}>Put it back</button>
        </div>
      </section>
      <section id="pg-years" role="tabpanel" ${this.tab === "years" ? "" : "hidden"}>
        <p class="small">Both are real measurements, played with the same music rules.</p>
        ${this.windows.length < 2 ? `<p>Only one time is available here.</p>` : `
        <div class="ab-row"><span class="ab-tag a">A</span><div class="chips" role="radiogroup" aria-label="Time A">${this.windows.map((w) => `<button class="chip" role="radio" aria-checked="${w.key === this.a}" data-a="${esc(w.key)}">${esc(w.label)}</button>`).join("")}</div></div>
        <div class="ab-row"><span class="ab-tag b">B</span><div class="chips" role="radiogroup" aria-label="Time B">${this.windows.map((w) => `<button class="chip" role="radio" aria-checked="${w.key === this.b}" data-b="${esc(w.key)}">${esc(w.label)}</button>`).join("")}</div></div>
        <div class="pg-buttons">
          <button class="pill" id="pg-a">▶ A</button><button class="pill" id="pg-b">▶ B</button><button class="pill primary" id="pg-ab">▶ A then B</button>
        </div>`}
      </section>`;

    $("pg-close").onclick = () => this.close();
    $("pg-tab-pretend").onclick = () => ((this.tab = "pretend"), this.stop(), this.render());
    $("pg-tab-years").onclick = () => {
      this.tab = "years";
      this.stop();
      this.s = { ...DEFAULTS };
      this.host.pretendGlobe(null);
      $("pretend-tag").hidden = true;
      this.render();
      this.host.luna.say("Pick two real times, A and B. Listen to both. Can you hear the difference?");
    };
    for (const sl of SLIDERS[experience]) {
      const input = document.getElementById(`pg-${sl.key}`) as HTMLInputElement | null;
      if (!input) continue;
      input.oninput = () => {
        this.s[sl.key] = +input.value;
        $(`pg-${sl.key}-out`).textContent = sl.fmt(+input.value);
        input.setAttribute("aria-valuetext", `${sl.fmt(+input.value)}, pretend`);
        this.paint();
        this.host.luna.caption(this.liveLine());
      };
      input.onchange = () => this.host.luna.say(this.liveLine(), { mood: "wow" });
    }
    document.getElementById("pg-play-pretend")?.addEventListener("click", () => this.playPretend());
    document.getElementById("pg-play-real")?.addEventListener("click", () => this.playValues(this.real, "real"));
    document.getElementById("pg-reset")?.addEventListener("click", () => {
      this.s = { ...DEFAULTS };
      this.render();
      this.paint();
      this.host.luna.say("All back to the real Earth!");
    });
    box.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => ((this.a = b.dataset.a!), this.render())));
    box.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => ((this.b = b.dataset.b!), this.render())));
    document.getElementById("pg-a")?.addEventListener("click", () => this.playYears(["A"]));
    document.getElementById("pg-b")?.addEventListener("click", () => this.playYears(["B"]));
    document.getElementById("pg-ab")?.addEventListener("click", () => this.playYears(["A", "B"]));
  }

  private changed(): boolean {
    return Object.keys(DEFAULTS).some((k) => this.s[k] !== DEFAULTS[k]);
  }

  private paint() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const { experience } = this.host.state();
      const p: Pretend = experience === "ocean" ? { seaWarmth: this.s.seaWarmth } : experience === "forest" ? { green: this.s.green } : { airWarmth: this.s.airWarmth };
      const on = this.changed();
      $("pretend-tag").hidden = !on;
      this.host.pretendGlobe(on ? p : null, experience === "pulse" ? this.s.rain : undefined, experience === "pulse" ? this.s.sun : undefined);
    });
  }

  /** The pretend values, built from the real latest measurement. */
  private pretendValues(): Vals {
    const { experience } = this.host.state();
    const r = this.real;
    const v: Vals = { ...r };
    if (experience === "ocean") {
      if (r.SST !== undefined) v.SST = r.SST + this.s.seaWarmth;
      if (r.SSTA !== undefined) v.SSTA = r.SSTA + this.s.seaWarmth;
    } else if (experience === "forest") {
      if (r.NDVI !== undefined) v.NDVI = r.NDVI * this.s.green;
      if (r.EVI !== undefined) v.EVI = r.EVI * this.s.green;
    } else {
      if (r.PRECTOTCORR !== undefined) v.PRECTOTCORR = r.PRECTOTCORR * this.s.rain;
      if (r.ALLSKY_SFC_SW_DWN !== undefined) v.ALLSKY_SFC_SW_DWN = r.ALLSKY_SFC_SW_DWN * this.s.sun;
      if (r.T2M !== undefined) v.T2M = r.T2M + this.s.airWarmth;
    }
    return v;
  }

  /** A short live caption while sliding (not spoken until the slider is let go). */
  private liveLine(): string {
    const { experience } = this.host.state();
    if (!this.changed()) return "That's the real Earth.";
    if (experience === "ocean") return this.s.seaWarmth > 0 ? `The sea is getting warmer… ${this.s.seaWarmth >= 1.5 ? "Look, white spots: corals are bleaching!" : "See the colour change?"}` : "Brrr, the sea is getting cooler!";
    if (experience === "forest") return this.s.green <= 0.05 ? "Oh no, the forest is all gone. The land is bare and brown." : this.s.green < 0.6 ? "Big patches of forest are disappearing…" : "A little bit of forest is gone.";
    const bits: string[] = [];
    if (this.s.rain === 0) bits.push("No rain at all!");
    else if (this.s.rain >= 2) bits.push("Lots and lots of rain!");
    else if (this.s.rain !== 1) bits.push(this.s.rain > 1 ? "More rain…" : "Less rain…");
    if (this.s.sun !== 1) bits.push(this.s.sun > 1 ? "Extra sunshine!" : "Less sunshine.");
    if (this.s.airWarmth !== 0) bits.push(this.s.airWarmth > 0 ? "The air is hotter." : "The air is colder.");
    return bits.join(" ");
  }

  /** What happened, in Luna's words. Pretend-only consequences, framed as "could", with no numbers invented. */
  private explain(): string {
    const { experience } = this.host.state();
    if (!this.changed()) return "That was the real Earth's song, made from the latest real measurement.";
    if (experience === "ocean") {
      const w = this.s.seaWarmth;
      if (w > 0)
        return `We pretended the sea was ${w} degrees warmer. The music went higher and sounded more tense, and the waves got brighter. ${w >= 1.5 ? "In real life, when the sea stays this warm for weeks, corals can get stressed and turn white. That's called bleaching, and fish can lose their homes." : "Even a little warmer matters to sea creatures."} Remember, this was pretend!`;
      return `We pretended the sea was ${-w} degrees cooler. The music went lower and calmer. Pretend only!`;
    }
    if (experience === "forest") {
      const g = this.s.green;
      if (g <= 0.05) return "We pretended the forest was all gone. Did you hear? The birds and insects went quiet, and the music dropped low and thin. In real life, animals would lose their food and homes. Good thing it's only pretend!";
      return `We pretended only ${Math.round(g * 100)} percent of the green was left. There were fewer birds and insects, and the music got lower and thinner. Animals need forests for food and shelter. This was pretend!`;
    }
    const out: string[] = ["We pretended the weather changed."];
    if (this.s.rain === 0) out.push("With no rain, the rain sound stopped and the beats went quiet. If it stays dry for a long time, plants get thirsty. That can become a drought.");
    else if (this.s.rain >= 2) out.push("With lots of rain, the beats got busy and the storm got loud. Lots of rain in a short time can cause floods.");
    else if (this.s.rain !== 1) out.push(`With ${this.s.rain > 1 ? "more" : "less"} rain, the beats got ${this.s.rain > 1 ? "busier" : "calmer"}.`);
    if (this.s.sun !== 1) out.push(`With ${this.s.sun > 1 ? "more" : "less"} sunshine, the music got ${this.s.sun > 1 ? "brighter" : "duller"}${this.s.sun > 1 ? " and more birds sang" : ""}.`);
    if (this.s.airWarmth !== 0) out.push(`The air was ${this.s.airWarmth > 0 ? "hotter, so the notes went higher" : "colder, so the notes went lower"}.`);
    out.push("Only pretend!");
    return out.join(" ");
  }

  private async playPretend() {
    await this.playValues(this.pretendValues(), "pretend");
  }

  private async playValues(v: Vals, kind: "real" | "pretend") {
    this.stop();
    await this.host.beforePlay();
    const { experience, palette, layers } = this.host.state();
    const frames = labFrames(v, PITCH_VAR[experience], 10);
    const step = 0.35;
    if (kind === "real") {
      // Show the real map while the real values play.
      this.host.pretendGlobe(null);
      $("pretend-tag").hidden = true;
    } else this.paint();
    this.host.luna.caption(kind === "real" ? "Listen: this is the real Earth." : "Listen: this is your pretend Earth!");
    announce(kind === "real" ? "Playing the real Earth" : "Playing your pretend Earth");
    let i = 0;
    const tick = () => {
      this.host.engine.play({ ...frames[i], index: i }, step, { experience, palette, layers });
      i++;
      if (i < frames.length) this.timer = window.setTimeout(tick, step * 1000);
      else
        this.timer = window.setTimeout(() => {
          this.stop();
          if (kind === "real" && this.changed()) this.paint();
          this.host.luna.say(kind === "real" ? "That was the real Earth's song, made from the latest real measurement." : this.explain(), { mood: kind === "pretend" ? "wow" : "happy", repeat: true });
        }, 1200);
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
    this.host.luna.say(`${line} One year can be different from another for lots of reasons, like weather and seasons.`, { repeat: true });
  }
}
