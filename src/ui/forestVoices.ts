import csvText from "../../Datasets/EARTHSONA_Mauritius_Vegetation.csv?raw";
import type { SonificationEngine } from "../audio/engine";
import { CulturalSampler, SAMPLE_INFO } from "../audio/cultural";
import { QA_MEANING, loadVegetationCsv, type VegetationObservation } from "../data/forestCsv";
import { MAX_STARTS, MIN_STARTS, NDVI_REFERENCE, describeChange, voiceFor } from "../sonification/forestVoices";
import { $, announce, esc } from "./dom";
import type { Luna } from "./luna";

/**
 * Forest Voices: the team's real Mauritius vegetation observations played through the team's SuperCollider
 * instrument (ported to the browser). Every number shown and heard comes from the CSV.
 */
export const FOREST_DATA = loadVegetationCsv(csvText, "Datasets/EARTHSONA_Mauritius_Vegetation.csv");

const PHRASE = 6; // seconds per observation
const GLIDE = 1.6; // seconds of pitch glide from A into B

export interface ForestVoicesHost {
  engine: SonificationEngine;
  luna: Luna;
  /** Stop other sounds and start the forest's nature soundscape. */
  beforePlay: () => Promise<void>;
  afterPlay: () => void;
  showPoint: (lat: number, lon: number, label: string) => void;
}

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export class ForestVoices {
  private out: GainNode | null = null;
  private timers: number[] = [];
  private token = 0;
  playing = false;

  constructor(private host: ForestVoicesHost) {}

  get observations(): VegetationObservation[] {
    return FOREST_DATA.observations;
  }

  render(): void {
    const obs = this.observations;
    const box = $("fv-panel");
    if (!obs.length) {
      box.innerHTML = `<h2 class="side-h" id="fv-h">Forest Voices</h2><p>Our vegetation file has no usable observations, so there is nothing to play. Nothing is made up.</p>`;
      return;
    }
    const letters = "ABCDEFGHIJ";
    const card = (o: VegetationObservation, i: number) => `
      <article class="fv-obs" data-i="${i}">
        <div class="fv-obs-top"><span class="fv-letter">${letters[i]}</span><div><strong>${esc(fmtDay(o.date))}</strong><span class="small">${esc(o.location)}, seen from space</span></div></div>
        <div class="fv-meter"><span class="fv-ico" aria-hidden="true">🌿</span><span class="fv-name">Greenness</span><span class="fv-bar"><i style="width:${Math.max(0, o.ndvi) * 100}%"></i></span><b>${o.ndvi.toFixed(2)}</b></div>
        ${o.evi !== null ? `<div class="fv-meter evi"><span class="fv-ico" aria-hidden="true">🍃</span><span class="fv-name">Leafiness</span><span class="fv-bar"><i style="width:${Math.max(0, o.evi) * 100}%"></i></span><b>${o.evi.toFixed(2)}</b></div>` : ""}
        <button class="pill small fv-play" data-play="${i}"><span aria-hidden="true">▶</span> Listen to ${letters[i]}</button>
      </article>`;
    const a = obs[0];
    const b = obs[obs.length - 1];
    box.innerHTML = `
      <div class="fv-head">
        <span class="fv-badge" aria-hidden="true">🌳</span>
        <div><h2 class="side-h" id="fv-h">Forest Voices</h2><p class="small">Real forest data from Mauritius, turned into music</p></div>
      </div>
      <div class="fv-leaves" id="fv-leaves" aria-hidden="true">${"<span></span>".repeat(12)}</div>
      <div class="fv-cards">${obs.map(card).join("")}</div>
      ${obs.length > 1 ? `<button class="pill primary fv-both" id="fv-both"><span aria-hidden="true">▶</span> Listen to ${letters[0]} then ${letters[obs.length - 1]}</button>` : ""}
      <button class="pill quiet small" id="fv-why">Why do they sound different?</button>
      <button class="pill quiet small" id="fv-stop" hidden>■ Stop</button>
      <details class="fv-science">
        <summary>🔬 The science behind it</summary>
        ${this.scienceHtml(a, b)}
      </details>`;
    box.querySelectorAll<HTMLButtonElement>("[data-play]").forEach((btn) => (btn.onclick = () => void this.play([+btn.dataset.play!])));
    document.getElementById("fv-both")?.addEventListener("click", () => void this.play(obs.map((_, i) => i)));
    $("fv-why").onclick = () => this.explain();
    $("fv-stop").onclick = () => this.stop(true);
  }

  private scienceHtml(a: VegetationObservation, b: VegetationObservation): string {
    const rows = this.observations
      .map((o) => `<tr><td>${esc(o.date)}</td><td>${o.ndvi.toFixed(4)}</td><td>${o.evi === null ? "—" : o.evi.toFixed(4)}</td><td>${o.summaryQA} (${esc(QA_MEANING[o.summaryQA] ?? o.quality)})</td><td>${voiceFor(o).semitones.toFixed(2)} st · ${voiceFor(o).startsPerSecond.toFixed(2)}/s</td></tr>`)
      .join("");
    const inst = SAMPLE_INFO.forest;
    return `
      <dl class="kv small">
        <dt>Dataset</dt><dd>${esc(a.dataset)} (NASA MODIS Terra vegetation indices, 250 m, 16-day composites)</dd>
        <dt>File</dt><dd><code>${esc(FOREST_DATA.source)}</code> (exported by the team from Google Earth Engine; read only, never changed)</dd>
        <dt>Place</dt><dd>${esc(a.location)}, ${a.lat}°, ${a.lon}°</dd>
        <dt>Observations</dt><dd>${this.observations.length} usable${FOREST_DATA.rejected.length ? `, ${FOREST_DATA.rejected.length} rejected (${esc(FOREST_DATA.rejected.map((r) => r.reason).join("; "))})` : ", none rejected"} · ${esc(a.date)} to ${esc(b.date)}</dd>
        <dt>NDVI</dt><dd>Normalized Difference Vegetation Index, unitless (−1 to 1). It compares near-infrared and red light reflected by plants: higher means greener, more active vegetation. It does not count trees.</dd>
        <dt>EVI</dt><dd>Enhanced Vegetation Index, unitless. Like NDVI but corrects for haze and soil; more sensitive in dense forests, and more affected by marginal-quality pixels.</dd>
        <dt>Quality</dt><dd>MOD13Q1 SummaryQA: 0 good · 1 marginal · 2 snow/ice · 3 cloudy. Both observations here are <strong>marginal</strong>: usable, with lower confidence.</dd>
      </dl>
      <div class="table-scroll flat"><table class="mapping"><thead><tr><th>Date</th><th>NDVI</th><th>EVI</th><th>QA</th><th>Sound</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h4>How the data makes the music</h4>
      <ul class="small">
        <li><strong>Instrument:</strong> the team's SuperCollider sound <code>${esc(inst.script)}</code> (sample <code>${esc(inst.file)}</code>, ${esc(inst.role)}), ported to the browser with the same pitch-shifter and overlapping starts.</li>
        <li><strong>Greenness (NDVI) → pitch:</strong> NDVI ${NDVI_REFERENCE} plays the sample at its original pitch; 0 is one octave lower, 1 one octave higher (like temperature in the original script).</li>
        <li><strong>Leafiness (EVI) → beat:</strong> ${MIN_STARTS} to ${MAX_STARTS} sounds per second (like wind in the original script).</li>
        <li><strong>Marginal quality → softer sound</strong>, so lower confidence can be heard. The team's “triangle-sound” recording marks the start of each date (it carries no data).</li>
        <li><strong>A then B:</strong> the pitch glides from one date to the next, so the melody moves as the data changes.</li>
      </ul>
      <p class="small"><strong>Careful:</strong> between these two dates NDVI rose slightly while EVI almost halved. Real forests rarely change that fast in 16 days, so this is more likely caused by haze or cloud edges in these marginal-quality pictures than by a real change in the forest.</p>`;
  }

  /** Play one or more observations in order through the team's instrument. */
  async play(indices: number[]): Promise<void> {
    return this.playObservations(indices.map((i) => this.observations[i]).filter(Boolean));
  }

  /** Play any real vegetation observations (the team CSV or a date picked on the history graph). */
  async playObservations(obs: VegetationObservation[], label = "Our forest data"): Promise<void> {
    this.stop(false);
    if (!obs.length) return;
    const my = ++this.token; // a newer request (e.g. a second date picked on the graph) replaces this one
    this.host.luna.caption("Getting the forest sounds ready…");
    await this.host.beforePlay();
    const ctx = this.host.engine.ctx;
    if (!ctx || my !== this.token) return;
    // A private output, so Stop can silence everything already scheduled.
    const out = ctx.createGain();
    out.connect(this.host.engine.output("data"));
    this.out = out;
    const sampler = new CulturalSampler(ctx, out);
    const [forestSample, triangle] = await Promise.all([sampler.load("forest"), sampler.load("triangle")]);
    if (my !== this.token) {
      out.disconnect();
      return;
    }
    if (!forestSample) {
      this.host.luna.say("I can't load our forest sound right now. Try again in a moment.", { mood: "concerned" });
      return;
    }
    this.playing = true;
    document.getElementById("fv-stop")?.removeAttribute("hidden");
    const letters = "ABCDEFGHIJ";
    const t0 = ctx.currentTime + 0.15;
    const first = obs[0];
    this.host.showPoint(first.lat, first.lon, label);
    this.host.luna.say(
      obs.length > 1 ? `Listen! First ${fmtDay(obs[0].date)}, then ${fmtDay(obs[obs.length - 1].date)}. Can you hear the forest change?` : `Listen to the forest on ${fmtDay(first.date)}! Greener means higher, leafier means a faster beat.`,
      { mood: "happy" },
    );
    obs.forEach((o, k) => {
      const v = voiceFor(o);
      const prev = k > 0 ? voiceFor(obs[k - 1]) : null;
      const start = t0 + k * (PHRASE + 0.6);
      if (triangle) sampler.play("triangle", start, 1, 0.9);
      const ratioAt = (at: number) => {
        if (!prev) return v.ratio;
        const p = Math.min(1, (at - start) / GLIDE);
        return 2 ** ((prev.semitones + (v.semitones - prev.semitones) * p) / 12);
      };
      sampler.pattern("forest", start + 0.15, start + PHRASE, v.startsPerSecond, ratioAt, v.gain, v.tone, (at, i) => this.at(ctx, at, () => this.beat(i)));
      this.host.engine.shapeNature("forest", { NDVI: { value: o.ndvi, unit: "NDVI" } });
      this.at(ctx, start, () => {
        this.mark(this.observations.indexOf(o));
        this.host.engine.shapeNature("forest", { NDVI: { value: o.ndvi, unit: "NDVI" } });
        announce(`Playing ${letters[this.observations.indexOf(o)]}: ${fmtDay(o.date)}`);
      });
    });
    const end = t0 + obs.length * (PHRASE + 0.6);
    this.at(ctx, end, () => {
      this.stop(false);
      if (obs.length > 1) this.explain();
      else this.host.luna.say(`That was ${fmtDay(first.date)}. Now try the other date, or listen to both!`, { mood: "encouraging" });
    });
  }

  /** Luna explains what changed between the first and last observation (and how sure we can be). */
  explain(): void {
    const obs = this.observations;
    if (obs.length < 2) {
      this.host.luna.say("We only have one forest picture so far, so there's nothing to compare yet.", { mood: "thoughtful" });
      return;
    }
    const c = describeChange(obs[0], obs[obs.length - 1]);
    this.host.luna.say(`${c.lines.join(" ")} But both satellite pictures were a bit hazy, so scientists would check more dates before saying the forest really changed.`, {
      mood: "thoughtful",
      extra: `<p class="small">Real values from our CSV: ${obs.map((o) => `${esc(o.date)} NDVI ${o.ndvi.toFixed(2)}${o.evi !== null ? `, EVI ${o.evi.toFixed(2)}` : ""}`).join(" · ")}</p>`,
    });
  }

  stop(byUser: boolean): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    if (this.out) {
      const g = this.out;
      const ctx = this.host.engine.ctx!;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      window.setTimeout(() => g.disconnect(), 300);
      this.out = null;
    }
    if (this.playing) this.host.afterPlay();
    this.playing = false;
    document.getElementById("fv-stop")?.setAttribute("hidden", "");
    this.mark(-1);
    if (byUser) this.host.luna.say("Stopped. Press a Listen button whenever you're ready!", { mood: "happy" });
  }

  private at(ctx: BaseAudioContext, when: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, Math.max(0, (when - ctx.currentTime) * 1000)));
  }

  private mark(i: number) {
    document.querySelectorAll<HTMLElement>(".fv-obs").forEach((el) => el.classList.toggle("now", +el.dataset.i! === i));
  }

  private beat(i: number) {
    const leaves = document.querySelectorAll<HTMLElement>("#fv-leaves span");
    const leaf = leaves[i % leaves.length];
    if (!leaf) return;
    leaf.classList.remove("on");
    void leaf.offsetWidth;
    leaf.classList.add("on");
  }
}
