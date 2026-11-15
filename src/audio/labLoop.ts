import type { SonificationEngine, RenderOptions } from "./engine";
import type { SoundFrame } from "../sonification/frames";
import { MELODY_OCTAVES } from "../sonification/mappings";
import type { SoundResponse } from "../lab/scenarios";

/**
 * The Earth Sound Lab's continuous, real-time sound: the latest real measurements of this place played in order
 * (REAL), or the same measurements changed by the WHAT IF? sliders. (Without a run it falls back to an 8-step phrase.)
 * Every step asks `source()` for the CURRENT values, so moving a slider is heard on the next beat (≈0.4 s).
 * Play / pause / resume / stop / restart; the AudioContext is resumed on every play (browsers suspend it).
 */
export type LoopState = "stopped" | "playing" | "paused";

export interface LoopSource {
  frame: SoundFrame;
  /** A run of real (or WHAT IF?) measurements played in order; when given, it replaces the phrase around `frame`. */
  frames?: SoundFrame[];
  opts: RenderOptions;
  /** Combined sound responses of the active WHAT IF? rules (identity in REAL mode). */
  fx: Required<Omit<SoundResponse, "text">>;
}

/** Melodic shape of the phrase, in SEMITONES around the data pitch (the data sets the centre). */
export const PHRASE = [0, 4, 7, 4, 2, 5, 0, -3];
export const BASE_STEP = 0.42;
export const NO_FX: LoopSource["fx"] = { notes: 0, busy: 1, bright: 1, tension: 0, fall: false, tempo: 1 };

/** Apply the phrase position and the rules' sound responses to a data frame (pure: unit-tested). */
export function shapeFrame(f: SoundFrame, step: number, fx: LoopSource["fx"], phrase = true): SoundFrame {
  const k = step % PHRASE.length;
  let pitch = f.pitch;
  if (pitch !== null) {
    // fx.notes is in scale steps (≈ 2 semitones each); the result stays on the continuous pitch line.
    const semis = (phrase ? PHRASE[k] : 0) + fx.notes * 2;
    pitch = Math.max(0, Math.min(1, pitch + semis / (12 * MELODY_OCTAVES)));
  }
  const clamp01 = (x: number | null) => (x === null ? null : Math.max(0, Math.min(1, x)));
  let harmony = f.harmony;
  if (fx.tension >= 0.6) harmony = { kind: "anomaly", anomaly: 2 };
  else if (fx.tension >= 0.25) harmony = { kind: "anomaly", anomaly: 1 };
  return {
    ...f,
    index: step,
    pitch,
    harmony,
    density: f.density === null ? (fx.busy !== 1 ? clamp01(0.25 * fx.busy) : null) : clamp01(f.density * fx.busy),
    brightness: clamp01((f.brightness ?? 0.45) * fx.bright),
    drop: fx.fall && (phrase ? k === 0 : step === 0),
    pan: Math.sin(step * 0.7) * 0.4,
  };
}

export class LabLoop {
  state: LoopState = "stopped";
  step = 0;
  private timer: number | null = null;
  onState: (s: LoopState) => void = () => {};
  /** step, the shaped frame, and the index in `frames` that was played (or -1 for the phrase). */
  onStep: (step: number, f: SoundFrame, index: number) => void = () => {};

  constructor(private engine: SonificationEngine, private source: () => LoopSource | null, private startNature: () => void, private stopNature: () => void) {}

  async play(): Promise<void> {
    if (this.state === "playing") return;
    await this.engine.start(); // creates or RESUMES the AudioContext (needs the user's tap)
    if (this.state === "stopped") this.step = 0;
    this.set("playing");
    this.startNature();
    this.tick();
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.clear();
    this.stopNature();
    this.set("paused");
  }

  async toggle(): Promise<void> {
    if (this.state === "playing") this.pause();
    else await this.play();
  }

  stop(): void {
    if (this.state === "stopped") return;
    this.clear();
    this.stopNature();
    this.step = 0;
    this.set("stopped");
  }

  async restart(): Promise<void> {
    this.clear();
    this.step = 0;
    if (this.state === "playing") this.tick();
    else {
      this.state = "stopped";
      await this.play();
    }
  }

  private tick = () => {
    if (this.state !== "playing") return;
    const src = this.source();
    if (!src) return this.stop();
    const dur = BASE_STEP / src.fx.tempo;
    // If the browser suspended audio (tab hidden, device sleep), resume it before scheduling.
    if (!this.engine.running) void this.engine.start();
    const run = src.frames?.length ? src.frames : null;
    const index = run ? this.step % run.length : -1;
    const f = shapeFrame(run ? run[index] : src.frame, this.step, src.fx, !run);
    if (f.pitch !== null) this.engine.play(f, dur, src.opts);
    this.onStep(this.step, f, index);
    this.step++;
    this.timer = window.setTimeout(this.tick, dur * 1000);
  };

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(s: LoopState) {
    this.state = s;
    this.onState(s);
  }
}
