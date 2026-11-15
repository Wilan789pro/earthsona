import type { ExperienceId } from "../data/types";
import type { SoundFrame } from "../sonification/frames";
import { densityHits, grooveDrive, grooveEnergy, groovePattern, harmonyIntervals, pitchFrequency, SCALES } from "../sonification/mappings";
import type { PaletteId } from "../sonification/palettes";
import type { AmbienceId } from "./ambience";
import type { SampleName } from "./cultural";

/**
 * Sonification engine (Web Audio API).
 *
 * StepRenderer schedules the sound for ONE data step at an exact time on any BaseAudioContext, so the
 * live player and the offline WAV export produce identical audio. It reads only SoundFrames: all the
 * data → sound rules come from src/sonification/mappings.ts; the palette only picks instruments and the
 * (data-independent) arrangement.
 *
 * EVERY sound is generated from measurements (see SONIFICATION.md). There is no ambience, no recording and
 * no fixed loop: if the data does not change, the sound does not change. Buses:
 *   data     — melody, harmony, pad, rain ticks, drop figure, no-data tick (all from the measurements)
 *   regional — Mauritius only: a Sega-inspired 6/8 groove whose density, intensity, brightness and drum pitch
 *              are set by the measurements (mappings.ts: grooveDrive / grooveEnergy)
 *   nature   — kept for compatibility; nothing plays on it any more (the old synthesised ambience is unused)
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
  /** Unused: the team's WAV samples are no longer played (kept in the repository). */
  cultural?: SampleName | null;
  /** Optional (default off): a breathy, clearly different sound across dates WITHOUT a measurement. */
  smooth?: boolean;
}

export class StepRenderer {
  private noise: AudioBuffer;

  constructor(private ctx: BaseAudioContext, private out: AudioNode, private regionalOut: AudioNode = out) {
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    // Deterministic noise (fixed seed), so the same data always gives exactly the same sound.
    let seed = 12345;
    for (let i = 0; i < ch.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      ch[i] = (seed / 0x3fffffff) - 1;
    }
  }

  render(f: SoundFrame, at: number, dur: number, o: RenderOptions): void {
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, f.pan * 0.7));
    pan.connect(this.out);

    if (f.pitch === null) {
      this.noDataTick(at, pan);
      // Optional smoothing: an airy whisper (filtered noise, never a melody note) at the estimated height,
      // so listeners can follow the line without mistaking it for a measurement.
      if (o.smooth && f.estimate !== null && f.estimate !== undefined) this.whisper(at, dur, pitchFrequency(o.experience, f.estimate), pan);
      return;
    }
    const bright = o.layers.brightness && f.brightness !== null ? f.brightness : 0.45;
    const freq = pitchFrequency(o.experience, f.pitch);
    const from = f.prevPitch !== null && f.prevPitch !== undefined ? pitchFrequency(o.experience, f.prevPitch) : null;

    if (o.layers.melody) this.melody(at, dur, freq, bright, f.delta, o.palette, pan, from);
    // A significant drop of the measurement: a soft falling two-note figure below the melody, so a big
    // decrease is clearly audible (documented in mappingSpec.ts).
    if (f.drop && o.layers.melody) {
      this.voice(at + dur * 0.1, dur * 0.4, freq / 2, 0.12, "triangle", pan);
      this.voice(at + dur * 0.5, dur * 0.45, (freq / 2) * 2 ** (-2 / 12), 0.12, "triangle", pan);
    }
    if (o.layers.harmony && f.harmony) {
      for (const st of harmonyIntervals(f.harmony).semitones) this.voice(at, dur, freq * 2 ** (st / 12), 0.09, "sine", pan);
    }
    if (o.layers.texture && f.texture !== null) this.pad(at, dur, o.experience, f.texture, pan, freq);
    if (o.palette === "sega" && o.layers.arrangement) {
      // Mauritius: the Sega-inspired 6/8 groove, generated from the data (it also carries the rain level in Earth's Pulse)
      const rp = this.ctx.createStereoPanner();
      rp.pan.value = pan.pan.value * 0.5;
      rp.connect(this.regionalOut);
      this.segaGroove(at, dur, freq, grooveDrive(o.experience, f), grooveEnergy(o.experience, f), rp);
    } else if (o.layers.rhythm && f.density !== null) this.density(at, dur, densityHits(f.density), o.palette, pan);
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

  /** Airy "in between" sound for the optional smoothing setting (band-passed noise, clearly not a note). */
  private whisper(at: number, dur: number, freq: number, dest: AudioNode) {
    this.noiseHit(at + 0.02, Math.min(0.6, dur * 0.8), 0.05, "bandpass", freq, 18, dest);
  }

  private melody(at: number, dur: number, freq: number, bright: number, delta: number, palette: PaletteId, dest: AudioNode, from: number | null = null) {
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
    // The note glides from the previous date's pitch, so the direction and size of each real change is heard.
    const glide = from !== null && Math.abs(Math.log2(freq / from)) > 0.002 ? Math.min(0.18, dur * 0.35) : 0;
    for (const [type, mul, lvl] of types) {
      const o = this.ctx.createOscillator();
      o.type = type;
      if (glide) {
        o.frequency.setValueAtTime(from! * mul, at);
        o.frequency.exponentialRampToValueAtTime(freq * mul, at + glide);
      } else o.frequency.value = freq * mul;
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

  private pad(at: number, dur: number, exp: ExperienceId, level: number, dest: AudioNode, melodyFreq?: number) {
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
    // The pad follows the melody's pitch (two or three octaves down) so the continuous melody never clashes with it.
    let root = SCALES[exp].root / 2;
    if (melodyFreq) {
      root = melodyFreq;
      while (root > 130) root /= 2;
    }
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
    src.start(at, 0);
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

  /**
   * Sega-inspired 6/8 groove for one data step: `drive` (0…1) sets how many of the six subdivisions play,
   * `energy` (0…1) sets the drum's strength and the shaker's brightness, and the drum is tuned to the data note.
   * Programmatic and deterministic; an original pattern, not a copy of any recording or song.
   */
  private segaGroove(at: number, dur: number, melodyFreq: number, drive: number, energy: number, dest: AudioNode) {
    let drumF = melodyFreq;
    while (drumF > 110) drumF /= 2;
    for (const s of groovePattern(drive)) {
      const t = at + (s * dur) / 6;
      if (s === 0 || s === 3) this.tunedDrum(t, drumF, (0.12 + 0.22 * energy) * (s === 0 ? 1 : 0.7), dest);
      else this.noiseHit(t, Math.min(0.06, dur / 6), 0.035 + 0.07 * energy, "highpass", 2500 + 5000 * energy, 0.7, dest);
    }
  }

  private tunedDrum(at: number, freq: number, peak: number, dest: AudioNode) {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 2, at);
    o.frequency.exponentialRampToValueAtTime(freq, at + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + 0.35);
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
  private buses: Partial<Record<Bus, GainNode>> = {};
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

  /**
   * The decorative nature ambience has been REMOVED: every audible sound now comes from the measurements.
   * These no-ops keep older callers harmless; ambience.ts is kept in the repository but never played.
   */
  startNature(_id?: AmbienceId): void {}
  shapeNature(_exp?: RenderOptions["experience"], _values?: SoundFrame["values"]): void {}
  resetNature(): void {}
  stopNature(): void {}
  get natureId(): AmbienceId | null {
    return null;
  }

  play(frame: SoundFrame, dur: number, o: RenderOptions): void {
    if (!this.ctx || !this.renderer || !this.running) return;
    const at = this.ctx.currentTime + 0.03;
    this.renderer.render(frame, at, dur, o);
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
