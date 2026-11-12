import type { SoundFrame } from "../sonification/frames";

/**
 * Steps through SoundFrames. The UI (chart playhead, progress bar, "now playing") and the engine all
 * subscribe to the same step event, so sound, visuals and labels always change together.
 */
export type StepListener = (index: number, frame: SoundFrame) => void;
export type StateListener = (state: "playing" | "paused" | "stopped") => void;

export class FramePlayer {
  frames: SoundFrame[] = [];
  index = 0;
  /** Data points per second. */
  rate = 4;
  playing = false;
  loop = false;
  private timer: number | null = null;
  private stepListeners: StepListener[] = [];
  private stateListeners: StateListener[] = [];

  onStep(fn: StepListener): void {
    this.stepListeners.push(fn);
  }
  onState(fn: StateListener): void {
    this.stateListeners.push(fn);
  }

  get stepSec(): number {
    return 1 / this.rate;
  }
  get durationSec(): number {
    return this.frames.length * this.stepSec;
  }
  get elapsedSec(): number {
    return this.index * this.stepSec;
  }

  /** Load new frames, keeping the position (as a fraction) so changing place/period mid-play is smooth. */
  load(frames: SoundFrame[], keepPosition = true): void {
    const frac = this.frames.length ? this.index / this.frames.length : 0;
    this.frames = frames;
    this.index = keepPosition ? Math.min(frames.length - 1, Math.floor(frac * frames.length)) : 0;
  }

  play(): void {
    if (!this.frames.length || this.playing) return;
    if (this.index >= this.frames.length) this.index = 0;
    this.playing = true;
    this.emitState("playing");
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.clear();
    this.emitState("paused");
  }

  stop(): void {
    this.playing = false;
    this.clear();
    this.index = 0;
    this.emitState("stopped");
  }

  replay(): void {
    this.clear();
    this.playing = false;
    this.index = 0;
    this.play();
  }

  seek(i: number): void {
    if (!this.frames.length) return;
    this.index = Math.max(0, Math.min(this.frames.length - 1, i));
    if (!this.playing) this.emit();
  }

  setRate(r: number): void {
    this.rate = r;
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    const f = this.frames[this.index];
    if (f) for (const fn of this.stepListeners) fn(this.index, f);
  }

  private emitState(s: "playing" | "paused" | "stopped") {
    for (const fn of this.stateListeners) fn(s);
  }

  private tick = (): void => {
    if (!this.playing) return;
    this.emit();
    this.index++;
    if (this.index >= this.frames.length) {
      if (this.loop) this.index = 0;
      else {
        this.timer = window.setTimeout(() => {
          this.playing = false;
          this.index = this.frames.length; // at the end; next play() restarts
          this.emitState("stopped");
        }, this.stepSec * 1000);
        return;
      }
    }
    this.timer = window.setTimeout(this.tick, this.stepSec * 1000);
  };
}
