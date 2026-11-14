import type { CleanSeries, SoundRole } from "../data/types";
import type { CleanPoint } from "../data/normalise";
import type { Track } from "../data/registry";
import { ABSOLUTE_RANGE, type HarmonyFrame } from "./mappings";

/**
 * Turns a Track (several aligned data layers) into one SoundFrame per time step.
 * The first layer with role "pitch" defines the time axis. Other layers are matched by date
 * (exact, or the nearest date within ±4 days — e.g. weekly SST vs. its anomaly).
 */
export type PitchScale = "relative" | "absolute";

export interface SoundFrame {
  index: number;
  time: string;
  /** 0..1, null = no data at this step (no-data cue). */
  pitch: number | null;
  harmony: HarmonyFrame | null;
  density: number | null;
  brightness: number | null;
  texture: number | null;
  /** Change of the pitch layer from the previous valid step, -1..1 (relative to the series range). */
  delta: number;
  /** -1 (start of period) … 1 (end) → stereo position. */
  pan: number;
  /** Raw values per variable at this step, for "now playing" and explanations. */
  values: Record<string, { value: number | null; unit: string; quality?: string }>;
  /** A significant DROP of the pitch variable since the previous valid step (see DROP_THRESHOLD). */
  drop?: boolean;
  /** Pitch level of the previous MEASURED step (for the glide from the last note), null if none. */
  prevPitch?: number | null;
  /**
   * Only for dates WITHOUT a measurement that the cleaning step bridged by interpolation: the ESTIMATED level,
   * used solely by the optional "smooth between measurements" sound. Never shown or played as a measurement.
   */
  estimate?: number | null;
}

/** Absolute decrease (in the variable's own unit) that counts as "significant" and changes the arrangement. */
export const DROP_THRESHOLD: Record<string, number> = { NDVI: 0.05, EVI: 0.05, SST: 1, T2M: 3 };

export function scaleValue(v: number, series: CleanSeries, mode: PitchScale): number {
  let min: number;
  let max: number;
  if (mode === "absolute" && ABSOLUTE_RANGE[series.variable]) ({ min, max } = ABSOLUTE_RANGE[series.variable]);
  else ({ min, max } = series.stats);
  if (max - min <= 0) return 0.5;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

function nearest(points: CleanPoint[], time: string, maxDays = 4): CleanPoint | null {
  const t = Date.parse(time);
  let best: CleanPoint | null = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = Math.abs(Date.parse(p.time) - t);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best && bestD <= maxDays * 86_400_000 ? best : null;
}

export function layerFor(track: Track, role: SoundRole): CleanSeries | null {
  return track.layers.find((l) => l.def.roles.includes(role))?.result.series ?? null;
}

export function trackToFrames(track: Track, mode: PitchScale = "relative"): SoundFrame[] {
  const pitchSeries = layerFor(track, "pitch") ?? track.layers[0].result.series;
  const axis = pitchSeries.points as CleanPoint[];
  const span = pitchSeries.stats.max - pitchSeries.stats.min || 1;
  let prev: number | null = null;

  return axis.map((pt, i) => {
    const values: SoundFrame["values"] = {};
    const at = (role: SoundRole): { series: CleanSeries; point: CleanPoint | null } | null => {
      const s = layerFor(track, role);
      if (!s) return null;
      const p = s === pitchSeries ? pt : nearest(s.points as CleanPoint[], pt.time);
      return { series: s, point: p };
    };
    // Interpolated (bridged) points are NOT observations: they count as missing everywhere.
    const measured = (p: CleanPoint | null | undefined) => (p && !p.bridged ? p.value : null);
    for (const l of track.layers) {
      const s = l.result.series;
      const p = s === pitchSeries ? pt : nearest(s.points as CleanPoint[], pt.time);
      values[s.variable] = p?.bridged ? { value: null, unit: s.unit, quality: "no measurement" } : { value: p?.value ?? null, unit: s.unit, quality: p?.quality };
    }

    const lvl = (role: SoundRole, scale: PitchScale = "relative") => {
      const x = at(role);
      const v = measured(x?.point);
      if (!x || v === null) return null;
      return scaleValue(v, x.series, scale);
    };

    let harmony: HarmonyFrame | null = null;
    const h = at("harmony");
    const hv = measured(h?.point);
    if (h && hv !== null) {
      harmony = h.series.variable === "SSTA" ? { kind: "anomaly", anomaly: hv } : { kind: "chord", level01: scaleValue(hv, h.series, mode) };
    }

    const value = measured(pt);
    const pitch = value === null ? null : scaleValue(value, pitchSeries, mode);
    const estimate = pt.bridged && pt.value !== null ? scaleValue(pt.value, pitchSeries, mode) : null;
    const delta = value === null || prev === null ? 0 : (value - prev) / span;
    const dropBy = DROP_THRESHOLD[pitchSeries.variable];
    const drop = value !== null && prev !== null && dropBy !== undefined && prev - value >= dropBy;
    const prevPitch = prev === null ? null : scaleValue(prev, pitchSeries, mode);
    if (value !== null) prev = value;

    return {
      index: i,
      time: pt.time,
      pitch,
      harmony,
      // Density and brightness use the global scale so "rainy" and "sunny" mean the same everywhere.
      density: lvl("density", "absolute"),
      brightness: lvl("brightness", "absolute"),
      texture: lvl("texture", mode),
      delta: Math.max(-1, Math.min(1, delta)),
      pan: axis.length > 1 ? (i / (axis.length - 1)) * 2 - 1 : 0,
      values,
      drop,
      prevPitch,
      estimate,
    };
  });
}

/** Frames for the Earth Sound Lab: one value set, repeated as a short loop (absolute scale). */
export function labFrames(
  v: Partial<Record<"T2M" | "PRECTOTCORR" | "ALLSKY_SFC_SW_DWN" | "NDVI" | "EVI" | "SST" | "SSTA", number>>,
  pitchVar: string,
  steps = 8,
): SoundFrame[] {
  const abs = (k: string, x: number | undefined) => {
    if (x === undefined) return null;
    const r = ABSOLUTE_RANGE[k];
    return Math.min(1, Math.max(0, (x - r.min) / (r.max - r.min)));
  };
  const values: SoundFrame["values"] = {};
  for (const [k, x] of Object.entries(v)) values[k] = { value: x ?? null, unit: "" };
  return Array.from({ length: steps }, (_, i) => ({
    index: i,
    time: "",
    pitch: abs(pitchVar, v[pitchVar as keyof typeof v]),
    harmony:
      v.SSTA !== undefined ? { kind: "anomaly", anomaly: v.SSTA } : v.EVI !== undefined ? { kind: "chord", level01: abs("EVI", v.EVI) ?? 0 } : null,
    density: abs("PRECTOTCORR", v.PRECTOTCORR),
    brightness: abs("ALLSKY_SFC_SW_DWN", v.ALLSKY_SFC_SW_DWN),
    texture: pitchVar === "NDVI" ? abs("NDVI", v.NDVI) : null,
    delta: 0,
    pan: 0,
    values,
  }));
}
