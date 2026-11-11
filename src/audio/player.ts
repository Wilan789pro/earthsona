import type { CleanSeries } from "../data/types";
import type { CleanPoint } from "../data/normalise";
import { toUnit } from "../data/normalise";
import type { SoundFrame } from "./engine";

/**
 * Steps through a CleanSeries one point at a time and turns each point into a SoundFrame.
 * The UI (chart playhead, "now playing") and the engine both subscribe to the same step event,
 * so sound, chart and labels always change together.
 */
export function seriesToFrames(series: CleanSeries): SoundFrame[] {
  const pts = series.points as CleanPoint[];
  const span = series.stats.max - series.stats.min || 1;
  let prev: number | null = null;
  return pts.map((p, i) => {
    const pan = pts.length > 1 ? (i / (pts.length - 1)) * 2 - 1 : 0;
    if (p.value === null) return { level: null, delta: 0, pan };
    const delta = prev === null ? 0 : (p.value - prev) / span;
    prev = p.value;
    return { level: toUnit(p.value, series.stats), delta, pan };
  });
}

export type StepListener = (index: number, point: CleanPoint, frame: SoundFrame) => void;

export class SeriesPlayer {
  series: CleanSeries | null = null;
  frames: SoundFrame[] = [];
  index = 0;
  /** Data points per second. */
  rate = 4;
  playing = false;
  loop = true;
  private timer: number | null = null;
  private listeners: StepListener[] = [];
  private endListeners: (() => void)[] = [];

  onStep(fn: StepListener): void {
    this.listeners.push(fn);
  }
  onEnd(fn: () => void): void {
    this.endListeners.push(fn);
  }

  get stepSec(): number {
    return 1 / this.rate;
  }

  load(series: CleanSeries): void {
    this.series = series;
    this.frames = seriesToFrames(series);
    this.index = 0;
    if (this.playing) this.restartTimer();
  }

  play(): void {
    if (!this.series || this.playing) return;
    this.playing = true;
    this.tick();
  }

  pause(): void {
    this.playing = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  seek(i: number): void {
    if (!this.series) return;
    this.index = Math.max(0, Math.min(this.series.points.length - 1, i));
    this.emit();
  }

  setRate(r: number): void {
    this.rate = r;
  }

  private restartTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.tick();
  }

  private emit(): void {
    if (!this.series) return;
    const p = this.series.points[this.index] as CleanPoint;
    for (const fn of this.listeners) fn(this.index, p, this.frames[this.index]);
  }

  private tick = (): void => {
    if (!this.playing || !this.series) return;
    this.emit();
    this.index++;
    if (this.index >= this.series.points.length) {
      this.index = 0;
      if (!this.loop) {
        this.pause();
        for (const fn of this.endListeners) fn();
        return;
      }
    }
    this.timer = window.setTimeout(this.tick, this.stepSec * 1000);
  };
}
