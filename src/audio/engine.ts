import type { ExperienceId } from "../data/types";

/**
 * Sonification engine (Web Audio). Merges the two Earthy prototypes:
 *  - interactive globe jukebox: main + harmonic oscillators, sub drone, resonant low-pass, LFO
 *  - 3D jukebox: pentatonic voice bank, stereo panning, WAV export
 *
 * It knows nothing about NASA, units or sources. It only receives SoundFrames, so any data
 * source that goes through the shared normalisation step sounds the same way.
 */
export interface SoundFrame {
  /** Value normalised to 0..1 within the series' own min..max. `null` = no data at this step. */
  level: number | null;
  /** Change from previous step, normalised to -1..1 (drives LFO / tremolo). */
  delta: number;
  /** Position in time, -1 (start) .. 1 (end) → stereo pan. */
  pan: number;
}

interface Timbre {
  root: number; // Hz
  scale: number[]; // semitone offsets (pentatonic)
  main: OscillatorType;
  harmonic: OscillatorType;
  subGain: number;
  q: number;
}

/** One voice per experience so the three soundscapes are recognisable. */
export const TIMBRES: Record<ExperienceId, Timbre> = {
  // Ocean Symphony: warm sine waves, major pentatonic, deep sub (ocean depth).
  ocean: { root: 196.0, scale: [0, 2, 4, 7, 9], main: "sine", harmonic: "sine", subGain: 0.22, q: 2 },
  // Forest Voices: airy triangle pad, major pentatonic, bright filter.
  forest: { root: 220.0, scale: [0, 2, 4, 7, 9], main: "triangle", harmonic: "sine", subGain: 0.08, q: 3 },
  // Earth's Pulse: firmer sawtooth-through-filter, minor pentatonic (tension as values climb).
  pulse: { root: 130.81, scale: [0, 3, 5, 7, 10], main: "triangle", harmonic: "sawtooth", subGain: 0.14, q: 5 },
};

const OCTAVES = 2;

/** level 0..1 → frequency quantised to the timbre's pentatonic scale over two octaves. */
export function levelToFrequency(level: number, t: Timbre): number {
  const steps = t.scale.length * OCTAVES;
  const idx = Math.min(steps, Math.max(0, Math.round(level * steps)));
  const octave = Math.floor(idx / t.scale.length);
  const semis = idx === steps ? 12 * OCTAVES : t.scale[idx % t.scale.length] + 12 * octave;
  return t.root * 2 ** (semis / 12);
}

export class SonificationEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private master!: GainNode;
  private voiceGain!: GainNode;
  private main!: OscillatorNode;
  private harmonic!: OscillatorNode;
  private sub!: OscillatorNode;
  private subGain!: GainNode;
  private filter!: BiquadFilterNode;
  private lfo!: OscillatorNode;
  private lfoDepth!: GainNode;
  private panner!: StereoPannerNode;
  private noiseBuffer!: AudioBuffer;
  private timbre: Timbre = TIMBRES.pulse;
  private volume = 0.7;

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start(): Promise<void> {
    if (!this.ctx) this.build();
    if (this.ctx!.state !== "running") await this.ctx!.resume();
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.voiceGain.gain.cancelScheduledValues(now);
    this.voiceGain.gain.setTargetAtTime(0, now, 0.05);
    await new Promise((r) => setTimeout(r, 150));
    await this.ctx.suspend();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setExperience(exp: ExperienceId): void {
    this.timbre = TIMBRES[exp];
    if (!this.ctx) return;
    this.main.type = this.timbre.main;
    this.harmonic.type = this.timbre.harmonic;
    this.filter.Q.value = this.timbre.q;
    const now = this.ctx.currentTime;
    this.sub.frequency.setTargetAtTime(this.timbre.root / 2, now, 0.2);
    this.subGain.gain.setTargetAtTime(this.timbre.subGain, now, 0.2);
  }

  /** Play one data step lasting `dur` seconds. */
  play(frame: SoundFrame, dur: number): void {
    if (!this.ctx || !this.running) return;
    if (frame.level === null) return this.noData(dur);
    const now = this.ctx.currentTime;
    const t = this.timbre;
    const f = levelToFrequency(frame.level, t);
    const glide = Math.min(0.08, dur / 4);

    this.main.frequency.setTargetAtTime(f, now, glide);
    this.harmonic.frequency.setTargetAtTime(f * 1.5, now, glide); // a fifth above
    // Brightness follows the value (from the prototype's NDVI → filter-cutoff mapping).
    this.filter.frequency.setTargetAtTime(400 + frame.level * 3600, now, glide);
    // Bigger jumps → faster, deeper wobble (from the prototype's delta → tremolo mapping).
    const d = Math.min(1, Math.abs(frame.delta));
    this.lfo.frequency.setTargetAtTime(0.3 + d * 6, now, 0.05);
    this.lfoDepth.gain.setTargetAtTime(80 + d * 900, now, 0.05);
    this.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, frame.pan * 0.8)), now, 0.1);

    // Gentle pluck envelope so each step is audible as a note.
    const g = this.voiceGain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.32, now, 0.01);
    g.setTargetAtTime(0.18, now + dur * 0.35, dur * 0.25);
  }

  /** Neutral "no data" cue: voices dip almost silent and a soft, dull tick plays. */
  noData(dur: number): void {
    if (!this.ctx || !this.running) return;
    const now = this.ctx.currentTime;
    this.voiceGain.gain.cancelScheduledValues(now);
    this.voiceGain.gain.setTargetAtTime(0.015, now, 0.02);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, now + Math.min(0.12, dur * 0.6));
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + 0.15);
  }

  private build(): void {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 64;
    this.panner = ctx.createStereoPanner();
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = 0;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;

    this.main = ctx.createOscillator();
    this.harmonic = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.35;
    this.sub = ctx.createOscillator();
    this.sub.type = "sine";
    this.subGain = ctx.createGain();

    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfoDepth = ctx.createGain();
    this.lfo.connect(this.lfoDepth).connect(this.filter.frequency);

    this.main.connect(this.filter);
    this.harmonic.connect(harmonicGain).connect(this.filter);
    this.filter.connect(this.voiceGain);
    this.sub.connect(this.subGain).connect(this.voiceGain);
    this.voiceGain.connect(this.panner).connect(this.master).connect(this.analyser).connect(ctx.destination);

    // Short white-noise buffer for the no-data tick.
    this.noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
    const ch = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    for (const o of [this.main, this.harmonic, this.sub, this.lfo]) o.start();
    const exp = (Object.keys(TIMBRES) as ExperienceId[]).find((k) => TIMBRES[k] === this.timbre) ?? "pulse";
    this.setExperience(exp);
  }
}

/**
 * Offline render of a whole series to a WAV blob (idea from the 3D jukebox prototype's export button).
 * Same mapping as live playback; gaps render as the no-data tick.
 */
export async function renderSeriesToWav(frames: SoundFrame[], experience: ExperienceId, stepSec: number): Promise<Blob> {
  const sampleRate = 44100;
  const duration = frames.length * stepSec + 0.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);
  const t = TIMBRES[experience];
  const out = ctx.createGain();
  out.gain.value = 0.6;
  out.connect(ctx.destination);

  const noise = ctx.createBuffer(1, Math.floor(sampleRate * 0.15), sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

  frames.forEach((fr, i) => {
    const at = i * stepSec;
    const pan = ctx.createStereoPanner();
    pan.pan.value = fr.pan * 0.8;
    pan.connect(out);
    if (fr.level === null) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15, at);
      g.gain.exponentialRampToValueAtTime(0.0005, at + 0.1);
      src.connect(g).connect(pan);
      src.start(at);
      return;
    }
    const f = levelToFrequency(fr.level, t);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400 + fr.level * 3600;
    filter.Q.value = t.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.3, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + stepSec * 0.98);
    filter.connect(g).connect(pan);
    for (const [type, mul, lvl] of [[t.main, 1, 1], [t.harmonic, 1.5, 0.35], ["sine", 0.5, t.subGain * 2]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(filter);
      o.start(at);
      o.stop(at + stepSec);
    }
  });

  const buf = await ctx.startRendering();
  return audioBufferToWav(buf);
}

function audioBufferToWav(buf: AudioBuffer): Blob {
  const nCh = buf.numberOfChannels;
  const len = buf.length * nCh * 2 + 44;
  const view = new DataView(new ArrayBuffer(len));
  let pos = 0;
  const u32 = (v: number) => (view.setUint32(pos, v, true), (pos += 4));
  const u16 = (v: number) => (view.setUint16(pos, v, true), (pos += 2));
  u32(0x46464952); u32(len - 8); u32(0x45564157); // "RIFF" len "WAVE"
  u32(0x20746d66); u32(16); u16(1); u16(nCh); // "fmt " chunk, PCM
  u32(buf.sampleRate); u32(buf.sampleRate * 2 * nCh); u16(nCh * 2); u16(16);
  u32(0x61746164); u32(len - pos - 4); // "data"
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
