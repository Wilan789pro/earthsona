import type { CleanSeries, EarthPoint, EarthSeries, SeriesStats } from "./types";

/**
 * Shared data-quality step, applied to EVERY series regardless of source, before anything is
 * charted or sonified:
 *  1. drop points with invalid dates, de-duplicate by time, sort ascending;
 *  2. coerce non-finite values to null;
 *  3. trim leading/trailing nulls (no point playing silence at the edges);
 *  4. bridge isolated single-point gaps by linear interpolation (flagged `bridged`), keep longer gaps
 *     as `null` — the sound engine plays a short neutral "no data" cue for those;
 *  5. compute min / max / mean over real values so the "Understand" text uses real numbers.
 */
export interface NormaliseOptions {
  /** Longest run of nulls that will be bridged by interpolation. Default 1. Set 0 to never bridge. */
  maxBridge?: number;
}

export interface CleanPoint extends EarthPoint {
  /** True when the value was interpolated across a short gap (not an observation). */
  bridged?: boolean;
  /** Why the original value was missing (e.g. "cloudy"), for bridged points. */
  bridgedFrom?: EarthPoint["quality"];
}

export function normaliseSeries(series: EarthSeries, opts: NormaliseOptions = {}): CleanSeries & { points: CleanPoint[] } {
  const maxBridge = opts.maxBridge ?? 1;

  const byTime = new Map<string, CleanPoint>();
  for (const p of series.points ?? []) {
    if (!p || typeof p.time !== "string" || Number.isNaN(Date.parse(p.time))) continue;
    const value = typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null;
    const quality = value === null ? (p.quality && p.quality !== "good" && p.quality !== "marginal" ? p.quality : "missing") : p.quality;
    // If a timestamp is duplicated, keep a real value over a null.
    const prev = byTime.get(p.time);
    if (!prev || prev.value === null) byTime.set(p.time, quality ? { time: p.time, value, quality } : { time: p.time, value });
  }
  let points = [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  // Trim edge nulls.
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi && points[lo].value === null) lo++;
  while (hi >= lo && points[hi].value === null) hi--;
  points = points.slice(lo, hi + 1);

  // Bridge short interior gaps.
  if (maxBridge > 0) {
    let i = 0;
    while (i < points.length) {
      if (points[i].value !== null) {
        i++;
        continue;
      }
      let j = i;
      while (j < points.length && points[j].value === null) j++;
      const run = j - i;
      if (run <= maxBridge && i > 0 && j < points.length) {
        const a = points[i - 1].value as number;
        const b = points[j].value as number;
        for (let k = 0; k < run; k++) {
          const t = (k + 1) / (run + 1);
          points[i + k] = { time: points[i + k].time, value: round(a + (b - a) * t), bridged: true, quality: "interpolated", bridgedFrom: points[i + k].quality };
        }
      }
      i = j;
    }
  }

  if (!points.some((p) => p.value !== null)) {
    throw new Error(`Series ${series.id} has no valid values`);
  }

  return { ...series, points, stats: computeStats(points) };
}

export function computeStats(points: CleanPoint[]): SeriesStats {
  // Statistics use observations only — bridged (interpolated) points are excluded.
  const real = points.filter((p): p is CleanPoint & { value: number } => p.value !== null && !p.bridged);
  const pool = real.length ? real : (points.filter((p) => p.value !== null) as (CleanPoint & { value: number })[]);
  let minPoint = pool[0];
  let maxPoint = pool[0];
  let sum = 0;
  for (const p of pool) {
    if (p.value < minPoint.value) minPoint = p;
    if (p.value > maxPoint.value) maxPoint = p;
    sum += p.value;
  }
  return {
    min: minPoint.value,
    max: maxPoint.value,
    mean: round(sum / pool.length),
    count: pool.length,
    gaps: points.filter((p) => p.value === null).length,
    first: pool[0],
    last: pool[pool.length - 1],
    minPoint,
    maxPoint,
  };
}

/** Value → 0..1 within the series' own range (what the sound engine consumes). */
export function toUnit(value: number, stats: SeriesStats): number {
  const span = stats.max - stats.min;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (value - stats.min) / span));
}

function round(v: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
