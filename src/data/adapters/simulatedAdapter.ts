import type { Adapter, EarthPoint, EarthSeries, ExperienceId, FetchParams } from "../types";
import { SIMULATED_LABEL, makeSeriesId } from "../parsers.js";

/**
 * Wraps the synthetic data that the original Earthy prototypes used (one baseline value per place,
 * e.g. OFFLINE_GEO_DB temp / ndvi) and expands it into a deterministic, seasonal time series so it
 * can drive the same player as real data.
 *
 * Everything here is clearly labelled `source.kind = "simulated"` and must NEVER be presented as a
 * NASA observation.
 */

const VARIABLES: Record<string, { label: string; unit: string; experience: ExperienceId }> = {
  T2M: { label: "Air temperature at 2 m", unit: "°C", experience: "pulse" },
  PRECTOTCORR: { label: "Precipitation (bias-corrected)", unit: "mm/day", experience: "pulse" },
  NDVI: { label: "Vegetation greenness (NDVI, 16-day)", unit: "NDVI (unitless)", experience: "forest" },
  SST: { label: "Sea surface temperature", unit: "°C", experience: "ocean" },
};

/** Small deterministic PRNG so the same region always "sounds" the same. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Baseline guess when a region has none (e.g. an arbitrary point clicked on the globe). */
export function estimateBaseline(lat: number) {
  const absLat = Math.abs(lat);
  return {
    temp: Math.round((28 - absLat * 0.55) * 10) / 10,
    ndvi: Math.max(0.05, Math.round((0.75 - absLat / 120) * 100) / 100),
    sst: Math.max(-1.5, Math.round((29 - absLat * 0.4) * 10) / 10),
  };
}

function timeAxis(variable: string, start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start.length === 4 ? `${start}-01-01` : start}T00:00:00Z`);
  const e = new Date(`${end.length === 4 ? `${end}-12-31` : end}T00:00:00Z`);
  if (variable === "NDVI") {
    // 16-day composites, like MOD13Q1.
    for (let y = s.getUTCFullYear(); y <= e.getUTCFullYear(); y++) {
      for (let doy = 1; doy <= 365; doy += 16) {
        const d = new Date(Date.UTC(y, 0, doy));
        if (d >= s && d <= e) out.push(d.toISOString().slice(0, 10));
      }
    }
  } else if (variable === "SST") {
    // Weekly.
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
  } else {
    // Monthly.
    for (let d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1)); d <= e; d.setUTCMonth(d.getUTCMonth() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

export function simulateSeries(params: FetchParams): EarthSeries {
  const { region, def } = params;
  const variable = def.variable;
  const meta = VARIABLES[variable] ?? { label: variable, unit: "", experience: params.experience };
  const base = region.baseline ?? estimateBaseline(region.lat);
  const rand = mulberry32(hash(`${region.id}:${variable}`));
  const south = region.lat < 0;
  const seasonAmp = Math.min(1, Math.abs(region.lat) / 40); // stronger seasons away from the equator

  const points: EarthPoint[] = timeAxis(variable, def.start, def.end).map((time, i, arr) => {
    const d = new Date(`${time}T00:00:00Z`);
    const yearFrac = (d.getUTCMonth() + d.getUTCDate() / 31) / 12;
    // Peak in local summer.
    const season = Math.cos(2 * Math.PI * (yearFrac - (south ? 0.04 : 0.54)));
    const trend = i / Math.max(1, arr.length - 1); // gentle warming / greening trend for the demo
    const noise = rand() - 0.5;
    let value: number;
    switch (variable) {
      case "T2M":
        value = base.temp + season * (2 + 12 * seasonAmp) + trend * 0.6 + noise * 1.2;
        break;
      case "PRECTOTCORR":
        value = Math.max(0, 3 + season * 2.5 + noise * 4 + (rand() > 0.9 ? rand() * 12 : 0));
        break;
      case "NDVI":
        value = Math.min(0.95, Math.max(-0.1, base.ndvi + season * 0.08 * (0.3 + seasonAmp) + noise * 0.06));
        break;
      case "SST":
        value = base.sst + season * (0.8 + 4 * seasonAmp) + trend * 0.4 + noise * 0.3;
        break;
      default:
        value = season + noise;
    }
    // Demonstrate gap handling: a few missing samples, like cloudy NDVI composites.
    if (rand() < 0.02) return { time, value: null };
    return { time, value: Math.round(value * 1000) / 1000 };
  });

  return {
    id: makeSeriesId("sim", variable, region.id, def.periodKey),
    experience: params.experience,
    variable,
    label: meta.label,
    unit: meta.unit,
    region: { name: region.name, lat: region.lat, lon: region.lon },
    points,
    source: {
      kind: "simulated",
      name: SIMULATED_LABEL,
      citation:
        `${SIMULATED_LABEL}. Generated in the browser from a fixed baseline for ${region.name} ` +
        `with a synthetic seasonal cycle, trend and noise, to demonstrate the sonification when no real data is available.`,
    },
  };
}

export const simulatedAdapter: Adapter = {
  async fetchSeries(params) {
    return simulateSeries(params);
  },
};
