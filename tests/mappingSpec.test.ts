import { describe, expect, it } from "vitest";
import { normaliseSeries } from "../src/data/normalise";
import type { Track } from "../src/data/registry";
import type { EarthSeries, SeriesDef } from "../src/data/types";
import { trackToFrames } from "../src/sonification/frames";
import { ABSOLUTE_RANGE } from "../src/sonification/mappings";
import { MAPPING_SPEC, normaliseBySpec } from "../src/sonification/mappingSpec";
import { ndviToSemitones, voiceFor } from "../src/sonification/forestVoices";
import type { VegetationObservation } from "../src/data/forestCsv";

const FOREST_SAMPLE: VegetationObservation = { id: "x", date: "2024-01-01", ndvi: 0.5, evi: 0.5, summaryQA: 0, quality: "good", dataset: "d", location: "l", lat: 0, lon: 0, kind: "observation" };

const series = (variable: string, vals: (number | null)[], lat = 0): EarthSeries => ({
  id: variable, experience: "forest", variable, label: variable, unit: "", region: { name: "r", lat, lon: 0 },
  points: vals.map((v, i) => ({ time: `2020-${String(i + 1).padStart(2, "0")}-01`, value: v })),
  source: { kind: "nasa", name: "n", citation: "c" },
});
const track = (vals: (number | null)[], lat = 0): Track => {
  const d: SeriesDef = { source: "modis", variable: "NDVI", roles: ["pitch"], start: "2020", end: "2020", periodKey: "p" };
  return {
    experience: "forest",
    region: { id: "r", name: "r", lat, lon: 0, biome: "", baseline: { temp: 0, ndvi: 0, sst: 0 } },
    period: { key: "p", label: "p", layers: [d] },
    layers: [{ def: d, result: { series: normaliseSeries(series("NDVI", vals, lat)), origin: "bundled" } }],
    origin: "bundled", notices: [],
  };
};

describe("mapping specification", () => {
  it("documents every variable with ranges that match the code", () => {
    for (const r of MAPPING_SPEC) {
      expect(r.range).toEqual(ABSOLUTE_RANGE[r.variable]);
      expect(r.range.max).toBeGreaterThan(r.range.min);
      for (const k of ["dataset", "unit", "normalisation", "parameter", "minSound", "maxSound", "overTime"] as const) expect(r[k].length).toBeGreaterThan(1);
    }
    expect(MAPPING_SPEC.map((r) => r.variable).sort()).toEqual(Object.keys(ABSOLUTE_RANGE).sort());
  });
  it("normalisation is monotonic increasing for every variable", () => {
    for (const r of MAPPING_SPEC) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = normaliseBySpec(r.variable, r.range.min + ((r.range.max - r.range.min) * i) / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
  it("lower vegetation → lower pitch, the same across places and dates (global scale)", () => {
    const a = trackToFrames(track([0.3, 0.8, 0.6]), "absolute");
    const b = trackToFrames(track([0.9, 0.6, 0.2], 40), "absolute");
    expect(a[0].pitch!).toBeLessThan(a[1].pitch!);
    expect(a[2].pitch).toBe(b[1].pitch); // NDVI 0.6 is the same note in both places
    expect(b[2].pitch!).toBeLessThan(a[0].pitch!);
    expect(ndviToSemitones(0.3)).toBeLessThan(ndviToSemitones(0.8));
    expect(voiceFor({ ...FOREST_SAMPLE, ndvi: 0.4 }).ratio).toBeLessThan(voiceFor({ ...FOREST_SAMPLE, ndvi: 0.9 }).ratio);
  });
  it("a significant decrease is flagged for an arrangement change", () => {
    const f = trackToFrames(track([0.85, 0.84, 0.7, null, 0.72, 0.6]), "absolute");
    expect(f.map((x) => !!x.drop)).toEqual([false, false, true, false, false, true]);
  });
});
