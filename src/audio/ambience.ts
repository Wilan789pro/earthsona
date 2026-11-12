/**
 * Layer 1 — natural environmental sound.
 *
 * Every sound here is SYNTHESISED in the browser (filtered noise, oscillators and envelopes): there are no
 * recordings, so there is nothing to license. Each place has its own preset (waves vs surf vs open ocean,
 * rainforest vs boreal forest, tropical rain vs polar wind…).
 *
 * The natural layer does NOT carry data. It is the background that tells you where you are; the data-driven
 * sonification (engine.ts) plays on top of it. It is scheduled in real time, so it is not part of the WAV export.
 */

export type AmbienceId =
  | "reef-coast"
  | "surf-coast"
  | "open-ocean"
  | "island-forest"
  | "rainforest"
  | "boreal"
  | "island-weather"
  | "temperate-rain"
  | "polar-wind";

interface Preset {
  title: string;
  /** What a child hears, for captions and "Science behind the sound". */
  sounds: string[];
  waves?: { level: number; period: number; crash: number; tone: number };
  underwater?: number;
  wind?: { level: number; tone: number; gust: number; whistle?: number };
  rain?: { level: number; drops: number };
  thunder?: number; // rumbles per minute (average)
  leaves?: number;
  birds?: { rate: number; pitch: number };
  insects?: { level: number; rate: number };
  hoots?: number; // distant animal calls per minute
  ice?: number; // creaks per minute
}

export const AMBIENCE: Record<AmbienceId, Preset> = {
  "reef-coast": {
    title: "Gentle island waves",
    sounds: ["gentle rolling waves", "water lapping on the coast", "soft underwater hum", "light sea breeze"],
    waves: { level: 0.55, period: 7, crash: 0.25, tone: 0.55 },
    underwater: 0.22,
    wind: { level: 0.12, tone: 0.5, gust: 0.3 },
  },
  "surf-coast": {
    title: "Pacific surf",
    sounds: ["strong breaking surf", "rolling waves", "coastal wind"],
    waves: { level: 0.85, period: 10, crash: 0.85, tone: 0.75 },
    underwater: 0.12,
    wind: { level: 0.3, tone: 0.6, gust: 0.6 },
  },
  "open-ocean": {
    title: "Deep open ocean",
    sounds: ["long, deep ocean swell", "deep-water rumble", "wind over open water"],
    waves: { level: 0.6, period: 12, crash: 0.08, tone: 0.3 },
    underwater: 0.4,
    wind: { level: 0.32, tone: 0.4, gust: 0.5 },
  },
  "island-forest": {
    title: "Island forest",
    sounds: ["wind through trees", "rustling leaves", "birdsong", "a few insects"],
    wind: { level: 0.22, tone: 0.55, gust: 0.6 },
    leaves: 0.28,
    birds: { rate: 14, pitch: 1.1 },
    insects: { level: 0.12, rate: 0.4 },
  },
  rainforest: {
    title: "Dense rainforest",
    sounds: ["buzzing insects", "many birds", "light rain on leaves", "canopy wind", "distant thunder now and then"],
    wind: { level: 0.12, tone: 0.45, gust: 0.4 },
    leaves: 0.18,
    rain: { level: 0.2, drops: 10 },
    birds: { rate: 20, pitch: 0.9 },
    insects: { level: 0.34, rate: 1 },
    thunder: 0.4,
  },
  boreal: {
    title: "Northern boreal forest",
    sounds: ["wind in spruce and pine needles", "creaking branches", "a few birds", "distant animal calls"],
    wind: { level: 0.4, tone: 0.7, gust: 0.75 },
    leaves: 0.18,
    birds: { rate: 5, pitch: 1.25 },
    hoots: 1.2,
  },
  "island-weather": {
    title: "Tropical island weather",
    sounds: ["tropical rain showers", "warm wind", "distant thunder"],
    wind: { level: 0.28, tone: 0.5, gust: 0.6 },
    rain: { level: 0.4, drops: 24 },
    thunder: 0.9,
  },
  "temperate-rain": {
    title: "City rain",
    sounds: ["steady rain", "drops on roofs", "a light wind"],
    wind: { level: 0.2, tone: 0.45, gust: 0.4 },
    rain: { level: 0.42, drops: 30 },
  },
  "polar-wind": {
    title: "Antarctic wind and ice",
    sounds: ["strong polar wind", "whistling gusts", "blowing snow", "creaking ice"],
    wind: { level: 0.75, tone: 0.75, gust: 0.9, whistle: 0.35 },
    ice: 2,
  },
};

export function ambienceFor(id?: string): AmbienceId {
  return id && id in AMBIENCE ? (id as AmbienceId) : "reef-coast";
}

/** Long noise buffers (white / pink / brown) shared by all voices. */
function makeNoise(ctx: BaseAudioContext, kind: "white" | "pink" | "brown", seconds = 6): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else if (kind === "pink") {
        // Paul Kellet's refined pink-noise filter.
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Ambience {
  readonly out: GainNode;
  private noise: Record<"white" | "pink" | "brown", AudioBuffer>;
  private voice: { gain: GainNode; stop: () => void } | null = null;
  current: AmbienceId | null = null;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.noise = { white: makeNoise(ctx, "white"), pink: makeNoise(ctx, "pink"), brown: makeNoise(ctx, "brown") };
  }

  get running(): boolean {
    return this.voice !== null;
  }

  /** Start (or cross-fade to) a preset. */
  start(id: AmbienceId): void {
    if (this.voice && this.current === id) return;
    this.stop(1.5);
    this.current = id;
    this.voice = this.build(AMBIENCE[id]);
  }

  stop(fade = 0.8): void {
    if (!this.voice) return;
    const v = this.voice;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => v.stop(), fade * 1000 + 100);
    this.voice = null;
  }

  // -------------------------------------------------------------------------
  private build(p: Preset) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
    gain.connect(this.out);
    const stops: (() => void)[] = [];
    const timers: number[] = [];
    const every = (fn: () => void, ms: () => number) => {
      const loop = () => {
        fn();
        timers.push(window.setTimeout(loop, ms()));
      };
      timers.push(window.setTimeout(loop, ms() * Math.random()));
    };
    const loopSrc = (kind: "white" | "pink" | "brown") => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise[kind];
      s.loop = true;
      s.start(ctx.currentTime, Math.random() * 5);
      stops.push(() => s.stop());
      return s;
    };

    if (p.waves) this.waves(p.waves, gain, loopSrc, every);
    if (p.underwater) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 180;
      const g = ctx.createGain();
      g.gain.value = p.underwater * 0.5;
      loopSrc("brown").connect(f).connect(g).connect(gain);
    }
    if (p.wind) this.wind(p.wind, gain, loopSrc, every);
    if (p.rain) this.rain(p.rain, gain, loopSrc, every);
    if (p.leaves) this.leaves(p.leaves, gain, loopSrc, every);
    if (p.insects) this.insects(p.insects, gain, every, stops);
    if (p.birds) every(() => this.bird(p.birds!.pitch, gain), () => (60_000 / p.birds!.rate) * rand(0.4, 1.6));
    if (p.thunder) every(() => this.thunderClap(gain), () => (60_000 / p.thunder!) * rand(0.5, 1.5));
    if (p.hoots) every(() => this.hoot(gain), () => (60_000 / p.hoots!) * rand(0.5, 1.5));
    if (p.ice) every(() => this.creak(gain), () => (60_000 / p.ice!) * rand(0.4, 1.6));

    return {
      gain,
      stop: () => {
        timers.forEach((t) => clearTimeout(t));
        stops.forEach((s) => {
          try {
            s();
          } catch {
            /* already stopped */
          }
        });
        gain.disconnect();
      },
    };
  }

  /** Waves: low noise whose loudness and brightness swell and break at random intervals around `period`. */
  private waves(w: NonNullable<Preset["waves"]>, dest: AudioNode, src: (k: "white" | "pink" | "brown") => AudioBufferSourceNode, every: (fn: () => void, ms: () => number) => void) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const pan = ctx.createStereoPanner();
    src("pink").connect(f).connect(g).connect(pan).connect(dest);
    // A second, brighter noise for the foam of a breaking wave.
    const foamF = ctx.createBiquadFilter();
    foamF.type = "highpass";
    foamF.frequency.value = 1800;
    const foam = ctx.createGain();
    foam.gain.value = 0;
    src("white").connect(foamF).connect(foam).connect(pan);
    every(() => {
      const t = ctx.currentTime;
      const rise = w.period * rand(0.35, 0.5);
      const fall = w.period * rand(0.5, 0.7);
      const peak = w.level * rand(0.6, 1) * 0.55;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(peak, t, rise / 3);
      g.gain.setTargetAtTime(peak * 0.15, t + rise, fall / 3);
      f.frequency.cancelScheduledValues(t);
      f.frequency.setTargetAtTime(400 + w.tone * 1800, t, rise / 3);
      f.frequency.setTargetAtTime(260, t + rise, fall / 3);
      pan.pan.setTargetAtTime(rand(-0.5, 0.5), t, w.period / 2);
      if (w.crash > 0) {
        foam.gain.cancelScheduledValues(t);
        foam.gain.setTargetAtTime(0, t, 0.3);
        foam.gain.setTargetAtTime(w.crash * peak * 0.35, t + rise * 0.9, 0.15);
        foam.gain.setTargetAtTime(0, t + rise * 1.1, fall / 4);
      }
    }, () => w.period * 1000 * rand(0.8, 1.25));
  }

  /** Wind: band-passed noise with random gusts; optional resonant whistle (polar). */
  private wind(w: NonNullable<Preset["wind"]>, dest: AudioNode, src: (k: "white" | "pink" | "brown") => AudioBufferSourceNode, every: (fn: () => void, ms: () => number) => void) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 300 + w.tone * 500;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = w.level * 0.4;
    src("pink").connect(f).connect(g).connect(dest);
    let whistleF: BiquadFilterNode | null = null;
    let whistleG: GainNode | null = null;
    if (w.whistle) {
      whistleF = ctx.createBiquadFilter();
      whistleF.type = "bandpass";
      whistleF.frequency.value = 900;
      whistleF.Q.value = 18;
      whistleG = ctx.createGain();
      whistleG.gain.value = 0;
      src("white").connect(whistleF).connect(whistleG).connect(dest);
    }
    every(() => {
      const t = ctx.currentTime;
      const strength = rand(1 - w.gust, 1);
      g.gain.setTargetAtTime(w.level * 0.55 * strength, t, rand(0.6, 1.8));
      f.frequency.setTargetAtTime((250 + w.tone * 600) * (0.7 + strength * 0.7), t, 1.2);
      if (whistleF && whistleG) {
        whistleF.frequency.setTargetAtTime(rand(700, 1500), t, 1.5);
        whistleG.gain.setTargetAtTime(strength > 0.7 ? w.whistle! * 1.2 * strength : 0, t, 0.8);
      }
    }, () => rand(1200, 3200));
  }

  /** Rain: a steady hiss plus individual drops. */
  private rain(r: NonNullable<Preset["rain"]>, dest: AudioNode, src: (k: "white" | "pink" | "brown") => AudioBufferSourceNode, every: (fn: () => void, ms: () => number) => void) {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = r.level * 0.22;
    src("white").connect(hp).connect(lp).connect(g).connect(dest);
    every(() => {
      const n = Math.max(1, Math.round(r.drops / 8));
      for (let i = 0; i < n; i++) this.drop(ctx.currentTime + Math.random() * 0.12, r.level, dest);
    }, () => 125 * rand(0.5, 1.5));
  }

  private drop(at: number, level: number, dest: AudioNode) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    const f0 = rand(1800, 4200);
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, at + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level * rand(0.015, 0.05), at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    const p = ctx.createStereoPanner();
    p.pan.value = rand(-0.9, 0.9);
    o.connect(g).connect(p).connect(dest);
    o.start(at);
    o.stop(at + 0.06);
  }

  /** Leaves / needles: bursts of bright noise that follow gusts. */
  private leaves(level: number, dest: AudioNode, src: (k: "white" | "pink" | "brown") => AudioBufferSourceNode, every: (fn: () => void, ms: () => number) => void) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0;
    src("white").connect(f).connect(g).connect(dest);
    every(() => {
      const t = ctx.currentTime;
      const peak = level * rand(0.04, 0.12);
      g.gain.setTargetAtTime(peak, t, 0.4);
      g.gain.setTargetAtTime(peak * 0.15, t + rand(0.8, 2), 0.6);
    }, () => rand(1500, 4000));
  }

  /** Insects: amplitude-modulated high tones in short trains (cricket / cicada-like). */
  private insects(ins: NonNullable<Preset["insects"]>, dest: AudioNode, every: (fn: () => void, ms: () => number) => void, stops: (() => void)[]) {
    const ctx = this.ctx;
    if (ins.rate >= 1) {
      // Dense, continuous buzz (rainforest).
      const o = ctx.createOscillator();
      o.frequency.value = 5200;
      const am = ctx.createOscillator();
      am.frequency.value = 42;
      const amG = ctx.createGain();
      amG.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = ins.level * 0.03;
      am.connect(amG).connect(g.gain);
      const p = ctx.createStereoPanner();
      p.pan.value = 0.4;
      o.connect(g).connect(p).connect(dest);
      o.start();
      am.start();
      stops.push(() => o.stop(), () => am.stop());
    }
    every(() => {
      const t = ctx.currentTime;
      const f0 = rand(3800, 6500);
      const pulses = Math.round(rand(3, 9));
      const p = ctx.createStereoPanner();
      p.pan.value = rand(-0.8, 0.8);
      p.connect(dest);
      for (let i = 0; i < pulses; i++) {
        const at = t + i * 0.06;
        const o = ctx.createOscillator();
        o.frequency.value = f0;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(ins.level * 0.05, at + 0.01);
        g.gain.linearRampToValueAtTime(0, at + 0.04);
        o.connect(g).connect(p);
        o.start(at);
        o.stop(at + 0.05);
      }
    }, () => (1400 / ins.rate) * rand(0.5, 1.5));
  }

  /** A synthesised bird phrase: a few quick frequency sweeps. Not modelled on any particular species. */
  private bird(pitch: number, dest: AudioNode) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.05;
    const notes = Math.round(rand(2, 6));
    const base = rand(2200, 3600) * pitch;
    const p = ctx.createStereoPanner();
    p.pan.value = rand(-0.9, 0.9);
    const lvl = rand(0.02, 0.06);
    p.connect(dest);
    for (let i = 0; i < notes; i++) {
      const at = t0 + i * rand(0.09, 0.16);
      const o = ctx.createOscillator();
      o.type = "sine";
      const up = Math.random() > 0.4;
      o.frequency.setValueAtTime(base * (up ? 0.85 : 1.2), at);
      o.frequency.exponentialRampToValueAtTime(base * (up ? 1.25 : 0.8), at + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(lvl, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      o.connect(g).connect(p);
      o.start(at);
      o.stop(at + 0.1);
    }
  }

  private thunderClap(dest: AudioNode) {
    const ctx = this.ctx;
    const at = ctx.currentTime + 0.05;
    const s = ctx.createBufferSource();
    s.buffer = this.noise.brown;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(rand(250, 500), at);
    f.frequency.exponentialRampToValueAtTime(90, at + 4);
    const g = ctx.createGain();
    const peak = rand(0.12, 0.25);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + rand(0.2, 0.6));
    g.gain.setTargetAtTime(peak * 0.5, at + 0.8, 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, at + rand(3.5, 5.5));
    s.connect(f).connect(g).connect(dest);
    s.start(at, Math.random() * 3);
    s.stop(at + 6);
  }

  /** Distant animal call (soft two-note hoot). */
  private hoot(dest: AudioNode) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const f0 = rand(320, 420);
    for (const [dt, mul] of [[0, 1], [0.45, 0.92]] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f0 * mul, t + dt);
      o.frequency.linearRampToValueAtTime(f0 * mul * 0.94, t + dt + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.035, t + dt + 0.06);
      g.gain.linearRampToValueAtTime(0, t + dt + 0.38);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      o.connect(g).connect(lp).connect(dest);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
    }
  }

  /** Ice creak: a slow, resonant, low frequency glide. */
  private creak(dest: AudioNode) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const dur = rand(0.4, 1.2);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(rand(50, 90), t);
    o.frequency.linearRampToValueAtTime(rand(30, 140), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = rand(300, 700);
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
