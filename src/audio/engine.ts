import type { ExperienceId } from "../data/types";
import type { SoundFrame } from "../sonification/frames";
import { densityHits, harmonyIntervals, noteFrequency, noteIndex, SCALES } from "../sonification/mappings";
import type { PaletteId } from "../sonification/palettes";
import { natureModFor, Ambience, type AmbienceId } from "./ambience";
import { CulturalSampler, type SampleName } from "./cultural";

/**
 * Sonification engine (Web Audio API).
 *
 * StepRenderer schedules the sound for ONE data step at an exact time on any BaseAudioContext, so the
 * live player and the offline WAV export produce identical audio. It reads only SoundFrames: all the
 * data → sound rules come from src/sonification/mappings.ts; the palette only picks instruments and the
 * (data-independent) arrangement.
 *
 * Three buses keep the layers separate and individually switchable:
 *   nature   — Layer 1, synthesised environmental sound (ambience.ts), carries no data
 *   data     — Layer 2, the scientific sonification (every sound here comes from a measurement)
 *   regional — Layer 3, the regional arrangement (team recordings, or synthesised stand-in beats with a
 *              Sega-inspired 6/8 swing — not real Sega instruments), carries no data
 */
export interface LayerToggles {
  melody: boolean;
  harmony: boolean;
  rhythm: boolean;
  brightness: boolean;
  texture: boolean;
  arrangement: boolean;
}
export const ALL_LAYERS: LayerToggles = { melody: true, harmony: true, rhythm: true, brightness: true, texture: true, arrangement: true };

export interface RenderOptions {
  experience: ExperienceId;
  palette: PaletteId;
  layers: LayerToggles;
  /** The team's SuperCollider sample for this place (supercollider/cultural_sound/); replaces the synthesised accents. */
  cultural?: SampleName | null;
}

export class StepRenderer {
  private noise: AudioBuffer;

  constructor(private ctx: BaseAudioContext, private out: AudioNode, private regionalOut: AudioNode = out) {
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }

  render(f: SoundFrame, at: number, dur: number, o: RenderOptions): void {
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, f.pan * 0.7));
    pan.connect(this.out);

    if (f.pitch === null) {
      this.noDataTick(at, pan);
      return;
    }
    const bright = o.layers.brightness && f.brightness !== null ? f.brightness : 0.45;
    const freq = noteFrequency(o.experience, noteIndex(f.pitch));

    if (o.layers.melody) this.melody(at, dur, freq, bright, f.delta, o.palette, pan);
    // A significant drop of the measurement: a soft falling two-note figure below the melody, so a big
    // decrease is clearly audible (documented in mappingSpec.ts).
    if (f.drop && o.layers.melody) {
      this.voice(at + dur * 0.1, dur * 0.4, freq / 2, 0.12, "triangle", pan);
      this.voice(at + dur * 0.5, dur * 0.45, (freq / 2) * 2 ** (-2 / 12), 0.12, "triangle", pan);
    }
    if (o.layers.harmony && f.harmony) {
      for (const st of harmonyIntervals(f.harmony).semitones) this.voice(at, dur, freq * 2 ** (st / 12), 0.09, "sine", pan);
    }
    if (o.layers.texture && f.texture !== null) this.pad(at, dur, o.experience, f.texture, pan);
    if (o.layers.rhythm && f.density !== null) this.density(at, dur, densityHits(f.density), o.palette, pan);
    if (o.palette === "sega" && o.layers.arrangement && !o.cultural) {
      const rp = this.ctx.createStereoPanner();
      rp.pan.value = pan.pan.value * 0.5;
      rp.connect(this.regionalOut);
      // Forest: subtle wooden taps; ocean and pulse: a synthesised low thump + slap groove (a stand-in, not a ravann).
      if (o.experience === "forest") this.woodAccents(f.index, at, dur, rp);
      else this.segaArrangement(f.index, at, dur, rp);
    }
    if (o.palette === "sega" && !o.cultural && o.layers.brightness && f.brightness !== null) this.triangle(at + (dur * 2) / 3, 0.02 + f.brightness * 0.1, pan);
  }

  // --- voices ---------------------------------------------------------------
  private env(at: number, dur: number, peak: number, pluck: boolean): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.012);
    if (pluck) g.gain.exponentialRampToValueAtTime(0.0008, at + Math.min(0.7, dur * 0.95));
    else {
      g.gain.setTargetAtTime(peak * 0.6, at + 0.03, dur * 0.25);
      g.gain.setTargetAtTime(0, at + dur * 0.8, dur * 0.12);
    }
    return g;
  }

  private melody(at: number, dur: number, freq: number, bright: number, delta: number, palette: PaletteId, dest: AudioNode) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500 + bright * 5000;
    filter.Q.value = 1.2;
    const pluck = palette === "sega";
    const g = this.env(at, dur, pluck ? 0.28 : 0.22, pluck);
    // Big jumps between steps → a quick tremolo (from the prototype's "delta → wobble" mapping).
    const d = Math.min(1, Math.abs(delta));
    if (d > 0.15) {
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = 3 + d * 6;
      depth.gain.value = 0.06 * d;
      lfo.connect(depth).connect(g.gain);
      lfo.start(at);
      lfo.stop(at + dur);
    }
    filter.connect(g).connect(dest);
    const types: [OscillatorType, number, number][] = pluck
      ? [["triangle", 1, 1], ["sawtooth", 1, 0.12], ["sine", 2, 0.15]]
      : [["sine", 1, 1], ["triangle", 2, 0.18]];
    for (const [type, mul, lvl] of types) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      const og = this.ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(filter);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
  }

  private voice(at: number, dur: number, freq: number, peak: number, type: OscillatorType, dest: AudioNode) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.env(at, dur, peak, false);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private pad(at: number, dur: number, exp: ExperienceId, level: number, dest: AudioNode) {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 250 + level * 2200;
    const g = this.ctx.createGain();
    const peak = 0.03 + level * 0.07;
    const end = at + dur * 1.5; // overlap with the next step for a sustained texture
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, end);
    f.connect(g).connect(dest);
    const root = SCALES[exp].root / 2;
    for (const [mul, det] of [[1, -6], [1.5, 5], [2, 0]] as const) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = root * mul;
      o.detune.value = det;
      o.connect(f);
      o.start(at);
      o.stop(end + 0.02);
    }
  }

  private noiseHit(at: number, len: number, peak: number, type: BiquadFilterType, freq: number, q: number, dest: AudioNode) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + Math.min(0.008, len / 4));
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    src.connect(f).connect(g).connect(dest);
    src.start(at, Math.random() * 0.3);
    src.stop(at + len + 0.01);
  }

  /** Rhythmic density: same hit COUNT in every palette; the palette decides sound and placement. */
  private density(at: number, dur: number, hits: number, palette: PaletteId, dest: AudioNode) {
    if (hits === 0) return;
    if (palette === "sega") {
      // Synthesised shaker-style noise on a ternary grid (6 subdivisions per step), filled in a fixed order.
      const order = [0, 3, 2, 5];
      for (let k = 0; k < hits; k++) this.noiseHit(at + (order[k] * dur) / 6, Math.min(0.06, dur / 6), 0.09, "highpass", 5200, 0.7, dest);
    } else {
      for (let k = 0; k < hits; k++) this.noiseHit(at + (k * dur) / hits, 0.03, 0.07, "bandpass", 2600, 3, dest);
    }
  }

  /** Data-independent groove for the Sega-inspired palette (synthesised low thump + slap; not a recorded drum). */
  private segaArrangement(step: number, at: number, dur: number, dest: AudioNode) {
    if (step % 2 === 0) this.drum(at, 0.32, dest);
    else this.noiseHit(at + (dur * 2) / 3, 0.08, 0.06, "bandpass", 1400, 1.5, dest); // light slap on the off-beat
  }

  /** Subtle wooden accents (forest): a soft knock on every other step, a lighter one in between. */
  private woodAccents(step: number, at: number, dur: number, dest: AudioNode) {
    const knock = (t: number, freq: number, peak: number) => {
      const o = this.ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.8, t + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + 0.14);
    };
    if (step % 2 === 0) knock(at, 620, 0.12);
    knock(at + (dur * 2) / 3, 880, 0.06);
  }

  private drum(at: number, peak: number, dest: AudioNode) {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(52, at + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + 0.4);
    this.noiseHit(at, 0.05, peak * 0.25, "lowpass", 1800, 0.7, dest); // skin slap
  }

  private triangle(at: number, peak: number, dest: AudioNode) {
    // Inharmonic partials give a metallic "ting".
    for (const [mul, lvl] of [[1, 1], [2.76, 0.5], [5.4, 0.25]] as const) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 2400 * mul;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak * lvl, at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);
      o.connect(g).connect(dest);
      o.start(at);
      o.stop(at + 0.55);
    }
  }

  /** Neutral "no data" cue, identical in every palette. */
  private noDataTick(at: number, dest: AudioNode) {
    this.noiseHit(at, 0.11, 0.16, "bandpass", 900, 1.2, dest);
  }
}

function buildMaster(ctx: BaseAudioContext, volume: number) {
  const comp = ctx.createDynamicsCompressor(); // keeps loud passages comfortable
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = volume;
  comp.connect(master);
  return { input: comp, master };
}

export type Bus = "nature" | "data" | "regional";
/** Relative bus levels: nature is the foundation; regional music never overrides it. */
const BUS_LEVEL: Record<Bus, number> = { nature: 0.9, data: 1, regional: 0.55 };

/** Live engine: one AudioContext, three buses, analyser for the visualiser, master volume, ducking for narration. */
export class SonificationEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private renderer: StepRenderer | null = null;
  /** The team's SuperCollider instrument, ported: on the data bus (Forest Voices) and the regional bus. */
  cultural: CulturalSampler | null = null;
  regionalSampler: CulturalSampler | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private ambience: Ambience | null = null;
  private volume = 0.7;
  private enabled: Record<Bus, boolean> = { nature: true, data: true, regional: true };

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start(): Promise<void> {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const { input, master } = buildMaster(this.ctx, this.volume);
      this.master = master;
      this.duck = this.ctx.createGain();
      master.connect(this.duck);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.duck.connect(this.analyser).connect(this.ctx.destination);
      for (const b of ["nature", "data", "regional"] as Bus[]) {
        const g = this.ctx.createGain();
        g.gain.value = this.enabled[b] ? BUS_LEVEL[b] : 0;
        g.connect(input);
        this.buses[b] = g;
      }
      this.renderer = new StepRenderer(this.ctx, this.buses.data!, this.buses.regional!);
      this.cultural = new CulturalSampler(this.ctx, this.buses.data!);
      this.regionalSampler = new CulturalSampler(this.ctx, this.buses.regional!);
      for (const n of ["forest", "ocean", "triangle", "pulse"] as SampleName[]) {
        void this.cultural.load(n);
        void this.regionalSampler.load(n);
      }
      this.ambience = new Ambience(this.ctx, this.buses.nature!);
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  async stop(): Promise<void> {
    if (this.ctx?.state === "running") await this.ctx.suspend();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Switch one layer on or off without restarting anything. */
  setBus(bus: Bus, on: boolean): void {
    this.enabled[bus] = on;
    const g = this.buses[bus];
    if (this.ctx && g) g.gain.setTargetAtTime(on ? BUS_LEVEL[bus] : 0, this.ctx.currentTime, 0.15);
  }

  /** The node to connect extra sources to (after start()). Respects the bus's on/off switch. */
  output(bus: Bus): AudioNode {
    return this.buses[bus]!;
  }

  busOn(bus: Bus): boolean {
    return this.enabled[bus];
  }

  /** Lower everything while a spoken tip plays (the user started the tip, so they chose this). */
  setDucked(ducked: boolean): void {
    if (this.ctx && this.duck) this.duck.gain.setTargetAtTime(ducked ? 0.25 : 1, this.ctx.currentTime, 0.2);
  }

  /** Natural soundscape for the current place (cross-fades when the place changes). */
  startNature(id: AmbienceId): void {
    if (this.running) this.ambience?.start(id);
  }

  /** Let measurements (or Luna's pretend values) shape the nature sound directly. */
  shapeNature(exp: RenderOptions["experience"], values: SoundFrame["values"]): void {
    this.ambience?.setMod(natureModFor(exp, values));
  }

  resetNature(): void {
    this.ambience?.resetMod();
  }

  stopNature(): void {
    this.ambience?.stop();
  }

  get natureId(): AmbienceId | null {
    return this.ambience?.running ? this.ambience.current : null;
  }

  play(frame: SoundFrame, dur: number, o: RenderOptions): void {
    if (!this.ctx || !this.renderer || !this.running) return;
    const at = this.ctx.currentTime + 0.03;
    this.renderer.render(frame, at, dur, o);
    // Cultural layer: the team's sample, pitched by the same data note (±1 octave like the SuperCollider
    // instrument), with extra overlapping starts when the rhythm layer (rain) asks for them.
    if (o.cultural && this.regionalSampler && frame.pitch !== null && o.layers.arrangement) {
      const ratio = 2 ** ((frame.pitch * 24 - 12) / 12);
      const starts = Math.max(1, frame.density !== null ? Math.min(4, densityHits(frame.density)) : 1);
      for (let i = 0; i < starts; i++) this.regionalSampler.play(o.cultural, at + (i * dur) / starts, ratio, 1, null, frame.pan * 0.6);
    }
    this.shapeNature(o.experience, frame.values);
  }
}

/** Offline render of frames to a WAV blob — same renderer as live playback. */
export async function renderFramesToWav(frames: SoundFrame[], stepSec: number, o: RenderOptions): Promise<Blob> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * (frames.length * stepSec + 1)), rate);
  const { input, master } = buildMaster(ctx, 0.8);
  master.connect(ctx.destination);
  const regional = ctx.createGain();
  regional.gain.value = 0.55;
  regional.connect(input);
  const r = new StepRenderer(ctx, input, regional);
  frames.forEach((f, i) => r.render(f, 0.05 + i * stepSec, stepSec, o));
  return audioBufferToWav(await ctx.startRendering());
}

function audioBufferToWav(buf: AudioBuffer): Blob {
  const nCh = buf.numberOfChannels;
  const len = buf.length * nCh * 2 + 44;
  const view = new DataView(new ArrayBuffer(len));
  let pos = 0;
  const u32 = (v: number) => (view.setUint32(pos, v, true), (pos += 4));
  const u16 = (v: number) => (view.setUint16(pos, v, true), (pos += 2));
  u32(0x46464952); u32(len - 8); u32(0x45564157);
  u32(0x20746d66); u32(16); u16(1); u16(nCh);
  u32(buf.sampleRate); u32(buf.sampleRate * 2 * nCh); u16(nCh * 2); u16(16);
  u32(0x61746164); u32(len - pos - 4);
  const chans = Array.from({ length: nCh }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}
