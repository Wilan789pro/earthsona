import forestUrl from "../../supercollider/cultural_sound/forest2beat-sound.wav?url";
import oceanUrl from "../../supercollider/cultural_sound/ocean2beat-sound.wav?url";
import triangleUrl from "../../supercollider/cultural_sound/triangle-sound.wav?url";
import pulseUrl from "../../supercollider/cultural_sound/yoooo-pulse-sound.wav?url";

/**
 * Browser port of the team's SuperCollider instrument (supercollider/cultural_sound/*.scd).
 *
 *   SynthDef(\climateOverlapSound): PlayBuf (original speed, once) → PitchShift(windowSize 0.1,
 *   pitchRatio, no dispersion) → linen envelope (5 ms attack, 10 ms release), amplitude 0.25.
 *   Routine: starts a new, overlapping Synth every 1/rate seconds, scheduled from sound START.
 *
 * Here: the same four WAV recordings are decoded into AudioBuffers; PitchShift is reproduced as a granular
 * shifter with 0.1 s triangular grains overlapping ×4 (each grain reads the source at `ratio` speed, grains
 * advance at the original speed, so duration is unchanged and pitch moves); the same envelope and level.
 * Adaptation: the leading silence of each recording (0.2–1.3 s) is trimmed so beats land on time.
 * SuperCollider itself cannot run in a web page; this keeps its sounds and behaviour without a server.
 */
export type SampleName = "forest" | "ocean" | "triangle" | "pulse";

/**
 * What each sample IS, as far as the team's files tell us. The four .scd scripts are identical apart from the
 * file path; none names an instrument or a musical tradition, so no instrument name is claimed here.
 * kind: "recording" = an audio recording made/supplied by the team (source and licence to be confirmed).
 */
export const SAMPLE_INFO: Record<SampleName, { file: string; url: string; script: string; role: string; kind: "recording" }> = {
  forest: { file: "forest2beat-sound.wav", url: forestUrl, script: "forest2variable.scd", role: "a short percussive recording (0.7 s) named “forest2beat”; the instrument is not identified in the team's files", kind: "recording" },
  ocean: { file: "ocean2beat-sound.wav", url: oceanUrl, script: "ocean2variable.scd", role: "a short percussive recording (0.55 s) named “ocean2beat”; the instrument is not identified in the team's files", kind: "recording" },
  triangle: { file: "triangle-sound.wav", url: triangleUrl, script: "triangle2variable.scd", role: "a short metallic recording (0.55 s) named “triangle-sound” (the file name suggests a triangle; not verified)", kind: "recording" },
  pulse: { file: "yoooo-pulse-sound.wav", url: pulseUrl, script: "EarthPulseJapan.scd", role: "a vocal-like recording (1.6 s) named “yoooo-pulse”", kind: "recording" },
};

const WINDOW = 0.1; // PitchShift windowSize
const OVERLAP = 4;
const AMPLITUDE = 0.25; // SuperCollider amplitude

/** Decoded samples are shared by every sampler on the same AudioContext (decode once, reuse everywhere). */
const SHARED = new WeakMap<BaseAudioContext, { buffers: Map<SampleName, AudioBuffer>; loading: Map<SampleName, Promise<AudioBuffer | null>> }>();

export class CulturalSampler {
  private buffers: Map<SampleName, AudioBuffer>;
  private loading: Map<SampleName, Promise<AudioBuffer | null>>;

  constructor(private ctx: BaseAudioContext, private dest: AudioNode) {
    let shared = SHARED.get(ctx);
    if (!shared) {
      shared = { buffers: new Map(), loading: new Map() };
      SHARED.set(ctx, shared);
    }
    this.buffers = shared.buffers;
    this.loading = shared.loading;
  }

  load(name: SampleName): Promise<AudioBuffer | null> {
    const have = this.buffers.get(name);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(name);
    if (!p) {
      p = fetch(SAMPLE_INFO[name].url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => this.ctx.decodeAudioData(ab))
        .then((buf) => {
          const t = trimLeadingSilence(this.ctx, buf);
          this.buffers.set(name, t);
          return t;
        })
        .catch(() => null);
      this.loading.set(name, p);
    }
    return p;
  }

  loaded(name: SampleName): AudioBuffer | null {
    return this.buffers.get(name) ?? null;
  }

  /**
   * One Synth(\climateOverlapSound): play the recording once at `at`, pitch-shifted by `ratio`.
   * Returns the sound's duration in seconds (0 if the sample isn't loaded).
   */
  play(name: SampleName, at: number, ratio = 1, gain = 1, tone: number | null = null, pan = 0): number {
    const buf = this.buffers.get(name);
    if (!buf) return 0;
    const ctx = this.ctx;
    const out = ctx.createGain();
    const total = buf.duration + 0.15;
    // linen envelope: 5 ms attack, sustain, 10 ms release (as in the SynthDef)
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(AMPLITUDE * gain, at + 0.005);
    out.gain.setValueAtTime(AMPLITUDE * gain, at + Math.max(0.006, total - 0.01));
    out.gain.linearRampToValueAtTime(0, at + total);
    let node: AudioNode = out;
    if (tone) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = tone;
      out.connect(lp);
      node = lp;
    }
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p).connect(this.dest);

    if (Math.abs(ratio - 1) < 0.003) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(out);
      s.start(at);
      return total;
    }
    // Granular PitchShift: overlapping triangular grains of WINDOW seconds, hop WINDOW / OVERLAP.
    const hop = WINDOW / OVERLAP;
    // Overlap-add of decorrelated grains loses ~5 dB vs. the original (SuperCollider's PitchShift does too);
    // 0.7 instead of the amplitude-exact 2 / OVERLAP keeps shifted notes about as loud as unshifted ones.
    const norm = 0.7;
    for (let t = -WINDOW + hop; t < buf.duration; t += hop) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = ratio;
      const g = ctx.createGain();
      const g0 = at + Math.max(0, t);
      const offset = Math.max(0, t);
      const dur = WINDOW - (Math.max(0, t) - t);
      g.gain.setValueAtTime(0, g0);
      g.gain.linearRampToValueAtTime(norm, g0 + dur / 2);
      g.gain.linearRampToValueAtTime(0, g0 + dur);
      src.connect(g).connect(out);
      if (offset < buf.duration) {
        src.start(g0, offset, Math.min(dur * ratio, buf.duration - offset));
        src.stop(g0 + dur + 0.01);
      }
    }
    return total;
  }

  /**
   * The SuperCollider Routine: start a new overlapping sound every 1/startsPerSecond seconds from `from`
   * until `until`. `onStart` is called (in audio time) for each start so the UI can follow the beat.
   */
  pattern(name: SampleName, from: number, until: number, startsPerSecond: number, ratioAt: (t: number) => number, gain = 1, tone: number | null = null, onStart?: (at: number, i: number) => void): number {
    const interval = 1 / Math.max(0.05, startsPerSecond);
    let i = 0;
    for (let at = from; at < until - 0.02; at += interval, i++) {
      this.play(name, at, ratioAt(at), gain, tone, Math.sin(i * 1.7) * 0.35);
      onStart?.(at, i);
    }
    return i;
  }
}

/** Remove the silence before the first hit (keeps 5 ms of lead-in). */
export function trimLeadingSilence(ctx: BaseAudioContext, buf: AudioBuffer, threshold = 0.05): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak === 0) return buf;
  let first = buf.length;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++)
      if (Math.abs(d[i]) > threshold * peak) {
        first = Math.min(first, i);
        break;
      }
  }
  const start = Math.max(0, first - Math.round(0.005 * buf.sampleRate));
  if (start <= 0) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length - start, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(start), c);
  return out;
}
