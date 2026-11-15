import type { CleanPoint } from "../data/normalise";
import type { ExperienceId } from "../data/types";
import type { Values } from "./simulation";

/**
 * The Earth Sound Lab plays (and draws) a short run of REAL measurements from the place's dataset.
 * In WHAT IF? the sliders change that same run: the simulation is applied to the real values, so the
 * graph shows the real line and the pretend line together and the sound follows the line being drawn.
 *  - Ocean: "Sea warmth" shifts the measured sea temperature (SST and its anomaly) by the slider's change.
 *    The other ocean sliders affect the reef and the sound rules, not the temperature (no invented link).
 *  - Forest: the simplified forest model's greenness (all six sliders) scales the measured NDVI and EVI,
 *    i.e. how thick and green the forest is.
 *  - Earth's Pulse: Heat shifts T2M; Rain (and Storms) scale the rain; Sunshine scales the sunlight.
 */
export type RealVar = "SST" | "SSTA" | "NDVI" | "EVI" | "T2M" | "PRECTOTCORR" | "ALLSKY_SFC_SW_DWN";
export type Vals = Partial<Record<RealVar, number>>;
export interface LabRow {
  time: string;
  vals: Vals;
}

export const PITCH_VAR: Record<ExperienceId, RealVar> = { ocean: "SST", forest: "NDVI", pulse: "T2M" };
/** How many of the latest real measurements the lab plays and draws. */
export const LAB_POINTS = 24;

type LayerLike = { def: { variable: string }; result: { series: { points: unknown[] } } };

/** The latest `n` dates with a real (measured, not filled-in) value of the pitch variable, with the other variables on those dates. */
export function realRows(layers: LayerLike[], pitchVar: RealVar, n = LAB_POINTS): LabRow[] {
  const ok = (l: LayerLike) => (l.result.series.points as CleanPoint[]).filter((p) => p.value !== null && !p.bridged);
  const main = layers.find((l) => l.def.variable === pitchVar);
  if (!main) return [];
  const others = layers.filter((l) => l !== main).map((l) => ({ k: l.def.variable as RealVar, m: new Map(ok(l).map((p) => [p.time, p.value as number])) }));
  return ok(main)
    .slice(-n)
    .map((p) => {
      const vals: Vals = { [pitchVar]: p.value as number };
      for (const o of others) if (o.m.has(p.time)) vals[o.k] = o.m.get(p.time);
      return { time: p.time, vals };
    });
}

export interface WhatIfChange {
  exp: ExperienceId;
  /** Ocean: °C added to SST and SSTA. Pulse: °C added to T2M. */
  add: number;
  /** Forest: greenness factor. Pulse: rain factor. */
  factor: number;
  /** Pulse: sunlight factor. */
  sun: number;
  /** Pulse: extra rain (mm/day) where the real normal is almost dry, so a ratio is meaningless. */
  rainAdd: number;
}

/** Turn the sliders (v, relative to the real start `base`) into a change applied to real measurements. */
export function whatIfChange(exp: ExperienceId, v: Values, base: Values, greenRatio = 1): WhatIfChange {
  if (exp === "ocean") return { exp, add: (v.sst ?? 0) - (base.sst ?? 0), factor: 1, sun: 1, rainAdd: 0 };
  if (exp === "forest") return { exp, add: 0, factor: Math.max(0, Math.min(1.2, greenRatio)), sun: 1, rainAdd: 0 };
  const storms = 0.6 + 0.4 * (v.storms ?? 1);
  const wet = (base.rain ?? 0) >= 0.5;
  return {
    exp,
    add: (v.temp ?? 0) - (base.temp ?? 0),
    factor: (wet ? (v.rain ?? 0) / base.rain : 1) * storms,
    rainAdd: wet ? 0 : ((v.rain ?? 0) - (base.rain ?? 0)) * storms,
    sun: Math.max(0, (v.sun ?? 1) / Math.max(1, base.sun ?? 1)),
  };
}

export const NO_CHANGE = (exp: ExperienceId): WhatIfChange => ({ exp, add: 0, factor: 1, sun: 1, rainAdd: 0 });

/** Apply a WHAT IF? change to one set of real values (pure: unit-tested). */
export function applyChange(vals: Vals, c: WhatIfChange): Vals {
  const v: Vals = { ...vals };
  if (c.exp === "ocean") {
    if (v.SST !== undefined) v.SST += c.add;
    if (v.SSTA !== undefined) v.SSTA += c.add;
  } else if (c.exp === "forest") {
    if (v.NDVI !== undefined) v.NDVI *= c.factor;
    if (v.EVI !== undefined) v.EVI *= c.factor;
  } else {
    if (v.T2M !== undefined) v.T2M += c.add;
    if (v.PRECTOTCORR !== undefined) v.PRECTOTCORR = Math.max(0, v.PRECTOTCORR * c.factor + c.rainAdd);
    if (v.ALLSKY_SFC_SW_DWN !== undefined) v.ALLSKY_SFC_SW_DWN *= c.sun;
  }
  return v;
}

export const applyToRows = (rows: LabRow[], c: WhatIfChange): LabRow[] => rows.map((r) => ({ time: r.time, vals: applyChange(r.vals, c) }));

/** Which sliders move the drawn line, in child-friendly words. */
export const LINE_NOTE: Record<ExperienceId, string> = {
  ocean: "🌡️ Sea warmth moves the temperature line. The other sliders change the reef and its sound, not the temperature.",
  forest: "Every slider changes how thick and green the forest grows (NDVI) in our simple forest model.",
  pulse: "🌡️ Heat moves the temperature line. Rain, Storms and Sunshine change the rain and sunlight you hear.",
};
